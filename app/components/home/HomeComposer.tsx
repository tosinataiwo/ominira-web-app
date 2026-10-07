"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PaperclipIcon, Mic } from "lucide-react";
import { useProfile } from "@/lib/auth/useProfile";
import { comradeName } from "@/lib/reader/authorDisplay";
import ReaderAvatar from "@/app/components/shared/ReaderAvatar";
import { useTopics } from "@/lib/community/useTopics";
import TopicPickerTrigger, { TopicChips } from "@/app/components/home/TopicPicker";
import LinkPreviewCard from "@/app/components/shared/LinkPreviewCard";
import { extractLinks } from "@/lib/community/links";
import { useUploadBook } from "@/lib/materials/useUploadBook";
import { useAttachmentMetadataEditor } from "@/lib/materials/useAttachmentMetadataEditor";
import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE_BYTES, MAX_FILES, formatBytes } from "@/lib/materials/uploadLimits";
import { apiFetch, errorMessage } from "@/lib/api/client";
import DocumentPreviewCard from "@/app/components/materials/DocumentPreviewCard";
import { useCreateNote } from "@/lib/community/useNoteMutations";

// Matches NoteComposer's own `sm:` breakpoint decision (see that
// component's doc comment) — this composer forks the same way, so it
// needs the same real JS check, not just a CSS class.
const DESKTOP_BREAKPOINT_PX = 640;

// Caps the textarea's own auto-grow (see the `useEffect` sizing it below) —
// past this it scrolls internally instead of pushing the composer taller.
// Desktop keeps the original inline-box cap; mobile's full-screen overlay
// gets NoteComposer's own roomier pair, same reasoning as that component.
const DESKTOP_TEXTAREA_MAX_HEIGHT = 240;
const MOBILE_TEXTAREA_MAX_HEIGHT = 320;
const MOBILE_TEXTAREA_MIN_HEIGHT = 120;

// Accepted formats/caps live in lib/materials/uploadLimits.ts, shared with
// the library's AddBookModal — "Add a book" is really "attach files",
// already stretched to cover whatever lib/materials/useUploadBook's
// pipeline can parse: EPUB and PDF fully, DOCX metadata-only (title/author
// if the file has them set — see lib/book/docxParser.ts's own doc comment
// for why it stops there). New formats land by widening that shared list
// and the pipeline together, not by touching this component's own logic.
//
// A web page is *not* a file-picker format — a reader adds one exactly the
// way any other link goes into a post: paste the URL into the text field
// itself. LinkPreviewCard already renders the live preview for that; the
// only new behavior is what clicking it does once posted (see that
// component's own doc comment) — auto-ingesting into the in-app reader on
// first click, not a separate "add a link" attach step here.

// One composer, one draft — unlike NoteComposer (reused per book/reply
// target), Home only ever has this single instance, so a fixed key is
// enough; no per-target scoping needed.
const DRAFT_STORAGE_KEY = "ominira-home-draft";

type FileAttachment = {
  file: File;
  status: "parsing" | "uploading" | "done" | "error";
  error?: string;
  materialId?: string;
  // Only set when a real cover image is actually available: PDF's
  // rasterized first page, or an EPUB's own declared cover (see
  // useUploadBook's onThumbnail). DOCX has no cover concept, and not every
  // EPUB declares one — those just fall back to DocumentPreviewCard's own
  // generic placeholder icon instead of a real cover.
  coverUrl?: string;
  // Seeded from useUploadBook's `onMetadata` guess once parsing finishes —
  // "" (and the input showing `file.name` as a placeholder) until then. The
  // reader's own edits live here too, so the fields stay controlled inputs
  // whether or not `materialId` exists yet — see useAttachmentMetadataEditor.
  title: string;
  author: string;
};

/**
 * Home's composer — Claude Design's `Composer.dc.html` mock (the
 * "Substack Notes model": one write field, not a multi-mode form; quoting
 * a passage stays inside the book reader's own highlight -> note flow,
 * untouched here). Post is real: it's the same `POST /api/community/notes`
 * every book-anchored note goes through (lib/community/useNoteMutations.ts's
 * useCreateNote), just with `threadType: "discussion"` — a top-level post
 * with no ranges, optionally carrying whichever attached book finished
 * uploading first (see attachedMaterialId below). "Add files" is real
 * too: picking a file runs it through lib/materials/useUploadBook's shared
 * parse -> validate -> upload pipeline (reader-uploads-spec.md § 3),
 * producing a real `materialId` once it finishes, or an inline error using
 * that pipeline's own failure modes.
 * Voice recording is left out entirely for this pass (no audio
 * implementation yet), unlike the mock's mic tool.
 *
 * Topic tags are real too: the same `useTopics` list backing Home's
 * CategoryPills filter, via TopicPicker's multi-select (first pick is the
 * post's default topic — see that component's own doc comment). Tagging
 * is optional, not required to post — an untagged post just has no
 * `post_topics` rows, so it only ever shows up under "All" (CategoryPills's
 * own allKey), same as any other untopiced content. Opening the composer
 * while a specific pill is active (`defaultTopicId`, threaded down from
 * HomeCommunityFeed's own `topicId` filter state) pre-selects that topic
 * so posting from inside a topic "just works" without an extra tap; with
 * "All" active there's no single topic to infer, so the picker starts
 * empty and the post goes out untagged unless the reader adds one.
 *
 * Opens as a modal either way (`createPortal`'d, same as SearchModal) —
 * only the shell differs by viewport: desktop gets SearchModal's own
 * centered-card-over-a-backdrop treatment, mobile gets NoteComposer's
 * full-screen takeover (a centered card would waste most of a phone's own
 * screen and still fight the keyboard's viewport resize). Cancel is
 * always a real button in the header, matching NoteComposer's mobile
 * overlay — never a bare X, which reads as "dismiss" rather than the
 * deliberate "discard this post" it actually is.
 */
export default function HomeComposer({ defaultTopicId = null }: { defaultTopicId?: string | null }) {
  const { data: profile } = useProfile();
  const { data: topics } = useTopics();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(DRAFT_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [dismissedLinks, setDismissedLinks] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const { upload } = useUploadBook();
  const metadataEditor = useAttachmentMetadataEditor();
  // Files removed while still parsing/uploading — checked once that upload
  // actually resolves (see handleFileChange's .then below) so a materialId
  // that only becomes known *after* the reader hit "x" still gets deleted
  // instead of silently orphaning a materials row + Storage objects. The
  // File object itself is a stable identity for one picked file's whole
  // lifecycle, so it works as the key here same as it does for `files`
  // state above.
  const cancelledRef = useRef<Set<File>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // At most one book actually attaches to the post itself (posts.material_id
  // is a single FK) — the first upload to finish is it; any others a reader
  // picked still land in their personal library (lib/materials/
  // useUploadBook.ts already did that independently), just unattached.
  const attachedMaterialId = files.find((a) => a.status === "done")?.materialId ?? null;
  const createPost = useCreateNote(attachedMaterialId);

  const displayName = comradeName(profile?.pseudonym ?? "Reader");

  // Every distinct link currently in the draft gets its own live preview
  // (capped, see extractLinks) — same detection the posted note will
  // render with (NoteContent's own extractLinks call), minus whichever
  // ones this reader explicitly dismissed for this draft.
  const detectedLinks = useMemo(() => extractLinks(text), [text]);
  const visibleLinks = useMemo(() => detectedLinks.filter((url) => !dismissedLinks.has(url)), [detectedLinks, dismissedLinks]);

  // Same `matchMedia`-driven, layout-effect-timed desktop/mobile split as
  // NoteComposer — see that component's own doc comment for why it's a
  // layout effect (never paints the wrong shape for a frame) and why
  // `change`, not a resize listener.
  const [isDesktop, setIsDesktop] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`);
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Auto-grow to fit content, capped by viewport (CSS max-h + overflow-y-
  // auto on the element takes over as a plain scroll past that).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const max = isDesktop ? DESKTOP_TEXTAREA_MAX_HEIGHT : MOBILE_TEXTAREA_MAX_HEIGHT;
    const min = isDesktop ? 0 : MOBILE_TEXTAREA_MIN_HEIGHT;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`;
  }, [text, isDesktop]);

  // A modal either way (backdrop-covered on desktop, full-screen on
  // mobile) — locks the page behind it so it can't be scrolled into
  // accidentally, same as SearchModal's own fixed inset-0 takeover.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Mirrors every keystroke into localStorage, cleared once the draft's
  // back to empty — same "cleared not written" idiom as NoteComposer's own
  // draft persistence, so an abandoned draft doesn't linger as a stale
  // restore.
  useEffect(() => {
    try {
      if (text) window.localStorage.setItem(DRAFT_STORAGE_KEY, text);
      else window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // Best-effort — a private-browsing quota error shouldn't block typing.
    }
  }, [text]);

  // A restored draft should reopen the composer on its own rather than
  // leaving the reader to notice the idle pill doesn't actually say "empty"
  // anymore — same reasoning as NoteComposer's own restored-draft auto-expand.
  useEffect(() => {
    if (text) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function removeLink(url: string) {
    setDismissedLinks((existing) => new Set(existing).add(url));
  }

  function handleFileChange(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    // Slot count is checked against current `files`, not awaited state, so
    // a second pick right after a first respects what's already attached
    // (including ones still parsing/uploading) rather than racing it.
    const availableSlots = Math.max(0, MAX_FILES - files.length);
    const incoming = Array.from(picked).slice(0, availableSlots);
    if (fileInputRef.current) fileInputRef.current.value = "";

    const accepted: File[] = [];
    const attachments: FileAttachment[] = incoming.map((file) => {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return { file, status: "error", error: `Files must be under ${formatBytes(MAX_FILE_SIZE_BYTES)}.`, title: "", author: "" };
      }
      accepted.push(file);
      return { file, status: "parsing", title: "", author: "" };
    });
    setFiles((existing) => [...existing, ...attachments]);

    for (const file of accepted) {
      upload(file, {
        visibility: "public",
        onStage: (stage) => {
          if (stage !== "parsing" && stage !== "uploading") return;
          setFiles((existing) => existing.map((a) => (a.file === file ? { ...a, status: stage } : a)));
        },
        onThumbnail: (blobUrl) => {
          setFiles((existing) => existing.map((a) => (a.file === file ? { ...a, coverUrl: blobUrl } : a)));
        },
        onMetadata: ({ title, author }) => {
          setFiles((existing) => existing.map((a) => (a.file === file ? { ...a, title, author } : a)));
        },
      })
        .then((result) => {
          if (cancelledRef.current.delete(file)) {
            // Reader hit "x" before this landed — the attachment's already
            // gone from `files`, but the upload it triggered just finished
            // for real (a real materials row + Storage objects now exist).
            // Delete it the same way an already-"done" removeFile would.
            apiFetch(`/materials/${result.materialId}`, { method: "DELETE" }).catch(() => {});
            return;
          }
          metadataEditor.flushPending(file, result.materialId);
          setFiles((existing) =>
            existing.map((a) => (a.file === file ? { ...a, status: "done", materialId: result.materialId } : a))
          );
        })
        .catch((err) => {
          cancelledRef.current.delete(file);
          metadataEditor.forget(file);
          const message = err instanceof Error ? err.message : "Could not process this file.";
          setFiles((existing) => existing.map((a) => (a.file === file ? { ...a, status: "error", error: message } : a)));
        });
    }
  }

  // The "x" on a preview — not just a local dismiss: a still-in-flight
  // upload is flagged so its eventual materialId gets deleted the moment
  // it's known (see the .then above), and an already-`done` one is deleted
  // right away. An `error`red attachment never made a materials row, so
  // there's nothing to clean up server-side for it.
  function removeFile(index: number) {
    const attachment = files[index];
    if (attachment.status === "done" && attachment.materialId) {
      apiFetch(`/materials/${attachment.materialId}`, { method: "DELETE" }).catch(() => {});
    } else if (attachment.status === "parsing" || attachment.status === "uploading") {
      cancelledRef.current.add(attachment.file);
    }
    metadataEditor.forget(attachment.file);
    if (attachment.coverUrl) URL.revokeObjectURL(attachment.coverUrl);
    setFiles((existing) => existing.filter((_, i) => i !== index));
  }

  function reset() {
    setText("");
    setTopicIds([]);
    setDismissedLinks(new Set());
    for (const attachment of files) {
      if (attachment.coverUrl) URL.revokeObjectURL(attachment.coverUrl);
    }
    setFiles([]);
    setOpen(false);
    createPost.reset();
  }

  async function handlePost() {
    if (!canPost) return;
    try {
      await createPost.mutateAsync({
        ranges: [],
        content: { kind: "text", text },
        topicIds,
        threadType: "discussion",
      });
      reset();
    } catch {
      // createPost.error is surfaced inline below — the draft stays open
      // and intact so the reader can just retry rather than losing it.
    }
  }

  // Every attached file must have actually finished uploading — an errored
  // one hasn't, so it blocks posting same as a still-in-flight one until
  // the reader removes it (see removeFile) or it finishes. Text is only
  // required when there's nothing else to post — a successfully attached
  // file is a real thing to share on its own, same as Substack letting an
  // image-only post go out with no caption.
  const hasAttachedFile = files.some((a) => a.status === "done");
  const canPost =
    !createPost.isPending && (text.trim().length > 0 || hasAttachedFile) && files.every((a) => a.status === "done");

  if (!open) {
    return (
      <button
        onClick={() => {
          if (defaultTopicId) setTopicIds([defaultTopicId]);
          setOpen(true);
        }}
        className="flex w-full cursor-text items-center gap-2.5 rounded-sm border border-[var(--reader-border)] bg-[var(--reader-surface)] px-3.5 py-4.5 text-left"
      >
        <ReaderAvatar pseudonym={profile?.pseudonym ?? "Reader"} avatar={profile?.avatar} size={32} />
        <span className="flex-1 text-[13px] font-medium text-[var(--reader-text-muted)]">Share a note</span>
        <Mic size={17} className="text-[var(--reader-text-subtle)]" />
      </button>
    );
  }

  // Shared across both the desktop inline card and the mobile full-screen
  // overlay below — attachments (link/book/topic chips) all render inline
  // in the write area, same as any other composer's "what you attached
  // shows where you're writing" convention; only the *triggers* that add
  // more of them ("Add a book", "Add topics") live down in the toolbar.
  const linkPreviews = visibleLinks.length > 0 && (
    <div className="flex flex-col gap-2">
      {visibleLinks.map((url) => (
        <LinkPreviewCard key={url} url={url} dismissible onDismiss={() => removeLink(url)} />
      ))}
    </div>
  );

  const filePreviews = files.length > 0 && (
    <div className="flex flex-col gap-2">
      {files.map((attachment, i) => (
        <DocumentPreviewCard
          key={`${attachment.file.name}-${i}`}
          file={attachment.file}
          status={attachment.status}
          error={attachment.error}
          title={attachment.title}
          author={attachment.author}
          coverUrl={attachment.coverUrl}
          doneLabel="Uploaded"
          onRemove={() => removeFile(i)}
          onTitleChange={(title) => setFiles((existing) => existing.map((a) => (a.file === attachment.file ? { ...a, title } : a)))}
          onAuthorChange={(author) =>
            setFiles((existing) => existing.map((a) => (a.file === attachment.file ? { ...a, author } : a)))
          }
          onCommitTitle={(title) => {
            setFiles((existing) => existing.map((a) => (a.file === attachment.file ? { ...a, title } : a)));
            metadataEditor.commit(attachment.file, attachment.materialId, { title });
          }}
          onCommitAuthor={(author) => metadataEditor.commit(attachment.file, attachment.materialId, { author })}
        />
      ))}
    </div>
  );

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept={ACCEPTED_FILE_TYPES}
      className="hidden"
      onChange={(e) => handleFileChange(e.target.files)}
    />
  );

  // Rendered as one row (chips + the trigger that adds to them) so topics
  // read as a tag input — "here are your tags, here's the + to add
  // another" — rather than a chip list up in the write area with its own
  // "add" button off in the toolbar, disconnected from what it adds to.
  const topicTagRow = (
    <div className="flex flex-wrap items-center gap-1.5">
      <TopicChips topics={topics ?? []} selectedIds={topicIds} onChange={setTopicIds} />
      <TopicPickerTrigger topics={topics ?? []} selectedIds={topicIds} onChange={setTopicIds} />
    </div>
  );

  // The header, content, and toolbar are identical either way — only the
  // outer shell around this (backdrop-covered centered card vs. full-screen
  // takeover) differs by viewport, see the two return branches below.
  //
  // Header is identity-only (avatar + display name) — Cancel/Post live down
  // in the footer, same row as the attach-file toolbar (Substack's own
  // composer layout: actions anchored bottom-right next to the tools that
  // feed the post, not stranded up top away from what they're acting on).
  // Cancel stays a real labeled button rather than a bare header "X" —
  // still the deliberate "discard this post" action NoteComposer's own
  // mobile overlay uses, just relocated.
  const body = (
    <>
      <div className="flex flex-none items-center gap-2.5 border-b border-[var(--reader-border)] px-4 py-3">
        <ReaderAvatar pseudonym={profile?.pseudonym ?? "Reader"} avatar={profile?.avatar} size={28} />
        <span className="text-[13px] font-semibold text-[var(--reader-text)]">{displayName}</span>
      </div>
      {createPost.isError && (
        <div className="flex-none border-b border-[var(--reader-border)] bg-red-50 px-4 py-2 text-[13px] font-medium text-red-600">
          {errorMessage(createPost.error) ?? "Could not post — check your connection and try again."}
        </div>
      )}

      <div className="om-scroll min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex min-w-0 flex-col gap-3">
          <textarea
            ref={textareaRef}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Share a note"
            style={{
              minHeight: isDesktop ? 70 : MOBILE_TEXTAREA_MIN_HEIGHT,
              maxHeight: isDesktop ? DESKTOP_TEXTAREA_MAX_HEIGHT : MOBILE_TEXTAREA_MAX_HEIGHT,
            }}
            className={`w-full resize-none overflow-y-auto border-none bg-transparent outline-none placeholder:text-[var(--reader-text-muted)] ${
              isDesktop ? "text-[13px] font-semibold text-[var(--reader-text)]" : "text-base leading-relaxed text-[var(--reader-text)]"
            }`}
          />

          {linkPreviews}
          {filePreviews}
          {topicTagRow}
        </div>
      </div>

      <div className="flex flex-none items-center justify-between gap-3 border-t border-[var(--reader-border)] px-4 py-2.5">
        <div className="flex flex-none items-center gap-1">
          {profile?.canUpload && fileInput}
          {profile?.canUpload && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={files.length >= MAX_FILES}
            aria-label="Add document"
            title={files.length > 0 ? `Add document (${files.length}/${MAX_FILES})` : "Add document"}
            className="relative flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full text-[var(--reader-text-muted)] hover:bg-[var(--reader-surface-hover)] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <PaperclipIcon size={17} />
            {files.length > 0 && (
              <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-[var(--reader-surface)] px-1 text-[9px] font-bold leading-[13px] text-[var(--reader-text-subtle)]">
                {files.length}/{MAX_FILES}
              </span>
            )}
          </button>
          )}
        </div>

        <div className="flex flex-none items-center gap-2">
          <button
            onClick={reset}
            className="cursor-pointer bg-transparent border-none text-[12px] font-bold text-[var(--reader-text-muted)] hover:text-[var(--reader-text)] px-2 py-1.5"
          >
            Cancel
          </button>
          <button
            disabled={!canPost}
            onClick={handlePost}
            className={`rounded-sm border-none px-4 py-2 text-[13px] font-bold transition-colors ${
              canPost
                ? "bg-brand-500 text-white cursor-pointer hover:bg-brand-600"
                : "bg-[var(--reader-surface-hover)] text-[var(--reader-text-muted)] cursor-default"
            }`}
          >
            {createPost.isPending ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </>
  );

  // Guards against an SSR crash on a hypothetical first render straight
  // into `open` — same reasoning as NoteComposer's own guard.
  if (typeof document === "undefined") return null;

  if (isDesktop) {
    return createPortal(
      // Same backdrop/centering shape as SearchModal — a click on the
      // backdrop itself (not the card) closes it, same as tapping outside
      // any other dismissable overlay; a click inside the card never
      // bubbles here since none of the card's own handlers stop it, they
      // just never call reset.
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) reset();
        }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-6 py-16"
      >
        <div className="flex max-h-[calc(100vh-8rem)] w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] shadow-lg">
          {body}
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--reader-surface)]">
      <div className="flex h-full w-full flex-col bg-[var(--reader-surface)]" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        {body}
      </div>
    </div>,
    document.body
  );
}
