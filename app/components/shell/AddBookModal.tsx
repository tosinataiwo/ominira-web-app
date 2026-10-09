"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloudUpload, Plus, X } from "lucide-react";
import { useUploadBook } from "@/lib/materials/useUploadBook";
import type { UploadedBook } from "@/lib/materials/useUploadBook";
import { useAttachmentMetadataEditor } from "@/lib/materials/useAttachmentMetadataEditor";
import { ACCEPTED_FILE_TYPES, MEMBER_UPLOAD_LIMITS, formatBytes, type UploadLimits } from "@/lib/materials/uploadLimits";
import { apiFetch } from "@/lib/api/client";
import type { MaterialSummary } from "@/lib/api/types";
import { resolveBookThumbnailSrc, type CoverSource } from "@/lib/materials/image";
import DocumentPreviewCard, { type AttachmentVisibility } from "@/app/components/materials/DocumentPreviewCard";
import { confirmAction } from "@/stores/confirm-store";

// Matches HomeComposer's own `sm:` breakpoint decision — this modal takes
// the same shape that one does (full-screen takeover on mobile, backdrop-
// covered centered card on desktop), so it needs the same real JS check,
// not just a CSS class.
const DESKTOP_BREAKPOINT_PX = 640;

// Dropped files bypass the input's `accept` filter, so check them by name.
const ACCEPTED_EXTENSION = /\.(pdf|epub|docx)$/i;

type FileAttachment = {
  file: File;
  status: "parsing" | "uploading" | "done" | "error";
  /** 0–1 while `status === "uploading"`. */
  progress?: number;
  error?: string;
  materialId?: string;
  title: string;
  author: string;
  coverUrl?: string;
  visibility: AttachmentVisibility;
  categories: string[];
  coverSource: CoverSource;
};

type MaterialPatch = Pick<MaterialSummary, "id" | "title" | "author" | "visibility" | "categories" | "coverSource">;

/** The three cover sources a material can carry (lib/materials/image.ts) —
 * only the ones that actually have an image. Mirrors LibraryAdminView's own
 * coverSources list. Only ever non-empty for `editMaterial` (a material
 * that's already gone through enrichMaterial.ts) — a book still mid-upload
 * has nothing to offer yet. */
function materialCoverSources(material: MaterialSummary): { id: CoverSource; label: string; thumbnailUrl: string }[] {
  return [
    material.cover || material.thumbnail
      ? { id: "own" as const, label: "Your upload", thumbnailUrl: material.thumbnail ?? material.cover! }
      : null,
    material.openlibraryCoverUrl || material.openlibraryThumbnailUrl
      ? {
          id: "openlibrary" as const,
          label: "OpenLibrary",
          thumbnailUrl: material.openlibraryThumbnailUrl ?? material.openlibraryCoverUrl!,
        }
      : null,
    material.googleCoverUrl || material.googleThumbnailUrl
      ? { id: "google" as const, label: "Google Books", thumbnailUrl: material.googleThumbnailUrl ?? material.googleCoverUrl! }
      : null,
  ].filter((source): source is { id: CoverSource; label: string; thumbnailUrl: string } => source !== null);
}

/** Edit mode's one "attachment" — a material that's already fully uploaded,
 * standing in for a real in-flight upload so every generic per-attachment
 * path below (commit/remove/etc., all keyed off `attachment.file`) just
 * works unchanged. `file` is a stand-in, never touched as a real File (no
 * upload ever runs for it) — `size: 0` is what tells DocumentPreviewCard to
 * skip the file-size line it'd otherwise show. */
function attachmentFromMaterial(material: MaterialSummary): FileAttachment {
  return {
    file: { name: material.title, size: 0 } as File,
    status: "done",
    materialId: material.id,
    title: material.title,
    author: material.author,
    coverUrl: resolveBookThumbnailSrc(material) ?? undefined,
    visibility: material.visibility,
    categories: material.categories,
    coverSource: material.coverSource,
  };
}

/**
 * Library's single book-editing surface — both the multi-book upload
 * composer (library-contribution-ux-spec.md Step 4, BookListRow's "Add
 * books" entry point) and, via `editMaterial`, editing a book already in a
 * reader's library (BookListRow's "..." > Edit menu item). One modal
 * instead of two near-duplicates (the old EditUploadModal reimplemented
 * every field DocumentPreviewCard already renders) — a change to how a book
 * is previewed/edited here (the cover picker, the visibility checkbox,
 * whatever comes next) now applies everywhere a reader edits a book, not
 * just wherever happened to get updated.
 *
 * Same shared parse -> validate -> upload pipeline as before
 * (lib/materials/useUploadBook), and the same attachment card HomeComposer
 * uses (DocumentPreviewCard) — see that component's own doc comment for why
 * it grew optional retry/visibility/category/cover-source props instead of
 * forking. Every book still uploads the moment it's picked (mobile-only per
 * spec — the desktop composer mock doesn't exist yet, see
 * library-contribution-ux-spec.md's "Open items").
 *
 * `editMaterial` skips the file picker/upload entirely — `files` seeds with
 * one synthetic "done" attachment (`attachmentFromMaterial`) standing in
 * for the material, and every field edit already autosaves per-field the
 * instant it commits (`metadataEditor.commit`, same as a fresh upload's
 * fields once `materialId` is known) — there's no separate "Save" step to
 * reimplement. `onMaterialSaved`/`onMaterialDeleted` mirror the local-state
 * updates the old EditUploadModal reported back to BookListRow, fired
 * alongside each commit rather than only once on an explicit save.
 *
 * "Done" doesn't trigger anything — every book already uploaded (or
 * failed/got removed) by the time a reader taps it; it just confirms/closes,
 * same as HomeComposer's own "Post" only ever submits what already finished
 * uploading. Full width only below the desktop breakpoint (matches the
 * rest of this modal's own mobile/desktop split) — on desktop it's a normal
 * right-aligned button, not stretched across a footer with nothing else in it.
 *
 * `category` seeds every new book's default category tag (skipped for the
 * synthetic "All" pill, which isn't a real category, and irrelevant in edit
 * mode) — same "opens pre-tagged to whichever category is currently being
 * browsed" idea Step 1's entry points already promise, just carried through
 * to the composer instead of stopping at a caption. A reader can still
 * remove or add to it per book via the category picker; `categories` is the
 * curated list it offers (lib/categories/config.ts, threaded down the same
 * way LibraryView already gets it for CategoryPills).
 *
 * `layout="page"` renders the same composer inline instead of as a modal —
 * /admin/library/new's standalone page, with a drag-and-drop zone and a
 * sticky progress footer in place of the modal chrome — and `limits` raises the per-file
 * size/count caps there (the server enforces its own, see
 * lib/materials/uploadLimits.ts).
 */
export default function AddBookModal({
  category = "All",
  categories: availableCategories,
  onClose,
  onUploaded,
  editMaterial,
  onMaterialSaved,
  onMaterialDeleted,
  layout = "modal",
  limits = MEMBER_UPLOAD_LIMITS,
}: {
  category?: string;
  categories: string[];
  onClose: () => void;
  onUploaded?: (book: UploadedBook) => void;
  /** Edit mode — see this component's own doc comment. */
  editMaterial?: MaterialSummary;
  onMaterialSaved?: (updated: MaterialPatch) => void;
  onMaterialDeleted?: (id: string) => void;
  layout?: "modal" | "page";
  limits?: UploadLimits;
}) {
  const { upload } = useUploadBook();
  const metadataEditor = useAttachmentMetadataEditor();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileAttachment[]>(() => (editMaterial ? [attachmentFromMaterial(editMaterial)] : []));
  const cancelledRef = useRef<Set<File>>(new Set());
  const defaultCategories = category === "All" ? [] : [category];
  const editCoverSources = editMaterial ? materialCoverSources(editMaterial) : [];

  // Page layout only — the modal keeps its click-to-pick flow.
  const [dragging, setDragging] = useState(false);
  const [dropNotice, setDropNotice] = useState<string | null>(null);

  const [isDesktop, setIsDesktop] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`);
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function startUpload(file: File, visibility: AttachmentVisibility) {
    upload(file, {
      visibility,
      onStage: (stage) => {
        if (stage !== "parsing" && stage !== "uploading") return;
        setFiles((existing) => existing.map((a) => (a.file === file ? { ...a, status: stage, progress: 0 } : a)));
      },
      onProgress: (progress) => {
        setFiles((existing) => existing.map((a) => (a.file === file ? { ...a, progress } : a)));
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
          apiFetch(`/materials/${result.materialId}`, { method: "DELETE" }).catch(() => {});
          return;
        }
        metadataEditor.flushPending(file, result.materialId);
        setFiles((existing) =>
          existing.map((a) => (a.file === file ? { ...a, status: "done", materialId: result.materialId } : a))
        );
        onUploaded?.(result);
      })
      .catch((err) => {
        cancelledRef.current.delete(file);
        const message = err instanceof Error ? err.message : "Could not process this file.";
        setFiles((existing) => existing.map((a) => (a.file === file ? { ...a, status: "error", error: message } : a)));
      });
  }

  function handleFileChange(picked: FileList | File[] | null) {
    if (!picked || picked.length === 0) return;
    const availableSlots = Math.max(0, limits.maxFiles - files.length);
    const incoming = Array.from(picked).slice(0, availableSlots);
    if (inputRef.current) inputRef.current.value = "";

    const accepted: File[] = [];
    const attachments: FileAttachment[] = incoming.map((file) => {
      if (file.size > limits.maxFileSizeBytes) {
        return {
          file,
          status: "error",
          error: `Files must be under ${formatBytes(limits.maxFileSizeBytes)}.`,
          title: "",
          author: "",
          visibility: "public",
          categories: defaultCategories,
          coverSource: "own",
        };
      }
      accepted.push(file);
      return { file, status: "parsing", title: "", author: "", visibility: "public", categories: defaultCategories, coverSource: "own" };
    });
    setFiles((existing) => [...existing, ...attachments]);

    for (const file of accepted) startUpload(file, "public");
  }

  function retryFile(index: number) {
    const attachment = files[index];
    setFiles((existing) => existing.map((a, i) => (i === index ? { ...a, status: "parsing", error: undefined } : a)));
    startUpload(attachment.file, attachment.visibility);
  }

  function setVisibility(index: number, visibility: AttachmentVisibility) {
    const attachment = files[index];
    setFiles((existing) => existing.map((a, i) => (i === index ? { ...a, visibility } : a)));
    metadataEditor.commit(attachment.file, attachment.materialId, { visibility });
  }

  function setCategories(index: number, categories: string[]) {
    const attachment = files[index];
    setFiles((existing) => existing.map((a, i) => (i === index ? { ...a, categories } : a)));
    metadataEditor.commit(attachment.file, attachment.materialId, { categories });
  }

  function setCoverSource(index: number, coverSource: CoverSource) {
    const attachment = files[index];
    setFiles((existing) => existing.map((a, i) => (i === index ? { ...a, coverSource } : a)));
    metadataEditor.commit(attachment.file, attachment.materialId, { coverSource });
  }

  async function removeFile(index: number) {
    const attachment = files[index];
    const isEditTarget = !!editMaterial && attachment.materialId === editMaterial.id;
    if (
      isEditTarget &&
      !(await confirmAction({ title: `Delete "${attachment.title}"?`, message: "This can't be undone.", confirmLabel: "Delete", danger: true }))
    )
      return;

    if (attachment.status === "done" && attachment.materialId) {
      apiFetch(`/materials/${attachment.materialId}`, { method: "DELETE" }).catch(() => {});
    } else if (attachment.status === "parsing" || attachment.status === "uploading") {
      cancelledRef.current.add(attachment.file);
    }
    metadataEditor.forget(attachment.file);
    if (attachment.coverUrl) URL.revokeObjectURL(attachment.coverUrl);
    setFiles((existing) => existing.filter((_, i) => i !== index));

    if (isEditTarget) {
      onMaterialDeleted?.(attachment.materialId!);
      onClose();
    }
  }

  // Safety net for every close path (X, backdrop, Done) — title/author only
  // commit on the input's own `onBlur` (unlike the checkbox/category/cover
  // controls below, which commit the instant they're clicked), so a reader
  // who types a change and then taps straight into a close button without
  // the field ever losing focus first would otherwise lose that edit: it's
  // already reflected in `files` (every keystroke syncs there via
  // onTitleChange/onAuthorChange), just never sent. Re-sending an
  // already-committed value here is a harmless no-op PATCH, so this runs
  // unconditionally rather than trying to track "was this actually blurred".
  function flushAndClose() {
    for (const attachment of files) {
      if (!attachment.materialId) continue;
      metadataEditor.commit(attachment.file, attachment.materialId, { title: attachment.title, author: attachment.author });
    }
    onClose();
  }

  const canAddMore = !editMaterial && files.length < limits.maxFiles;
  const doneCount = files.filter((a) => a.status === "done").length;

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={ACCEPTED_FILE_TYPES}
      className="hidden"
      onChange={(e) => handleFileChange(e.target.files)}
    />
  );

  // D1's own "Add another book" treatment (dashed, full-width, plus icon) —
  // relabeled "Add books" so the same button reads the same whether it's
  // the very first pick or a later one, instead of switching label/shape
  // partway through.
  const addBooksButton = (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      disabled={!canAddMore}
      className="flex w-full flex-none cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-md)] border-[1.5px] border-dashed border-[var(--reader-border)] py-3.5 text-[13px] font-semibold text-[var(--reader-text-muted)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus size={16} />
      Add books
    </button>
  );

  const cards = files.map((attachment, i) => {
    const isEditTarget = !!editMaterial && attachment.materialId === editMaterial.id;

    // Fires alongside every commit below when this card is
    // editing an existing material — mirrors what the old
    // EditUploadModal reported back from its own explicit Save,
    // just per-field instead of all at once (there's no
    // separate Save step here; every commit already autosaves).
    const notifyEdit = (patch: Partial<MaterialPatch>) => {
      if (!isEditTarget || !editMaterial) return;
      onMaterialSaved?.({
        id: editMaterial.id,
        title: attachment.title,
        author: attachment.author,
        visibility: attachment.visibility,
        categories: attachment.categories,
        coverSource: attachment.coverSource,
        ...patch,
      });
    };

    return (
      <DocumentPreviewCard
        key={`${attachment.file.name}-${i}`}
        file={attachment.file}
        status={attachment.status}
        progress={attachment.progress}
        error={attachment.error}
        title={attachment.title}
        author={attachment.author}
        coverUrl={attachment.coverUrl}
        doneLabel={isEditTarget ? "" : "Uploaded"}
        visibility={attachment.visibility}
        categories={attachment.categories}
        availableCategories={availableCategories}
        coverSources={isEditTarget ? editCoverSources : undefined}
        coverSource={attachment.coverSource}
        onRemove={() => removeFile(i)}
        onRetry={() => retryFile(i)}
        onTitleChange={(title) => setFiles((existing) => existing.map((a) => (a.file === attachment.file ? { ...a, title } : a)))}
        onAuthorChange={(author) => setFiles((existing) => existing.map((a) => (a.file === attachment.file ? { ...a, author } : a)))}
        onCommitTitle={(title) => {
          setFiles((existing) => existing.map((a) => (a.file === attachment.file ? { ...a, title } : a)));
          metadataEditor.commit(attachment.file, attachment.materialId, { title });
          notifyEdit({ title });
        }}
        onCommitAuthor={(author) => {
          metadataEditor.commit(attachment.file, attachment.materialId, { author });
          notifyEdit({ author });
        }}
        onSetVisibility={(visibility) => {
          setVisibility(i, visibility);
          notifyEdit({ visibility });
        }}
        onSetCategories={(categories) => {
          setCategories(i, categories);
          notifyEdit({ categories });
        }}
        onSetCoverSource={
          isEditTarget
            ? (coverSource) => {
                setCoverSource(i, coverSource);
                notifyEdit({ coverSource });
              }
            : undefined
        }
      />
    );
  });

  if (layout === "page") {
    const openPicker = () => inputRef.current?.click();
    const dropzoneTone = dragging
      ? "border-brand-400 bg-brand-500/5"
      : "border-[var(--reader-border)] hover:border-brand-300 hover:bg-[var(--reader-surface-hover)]";
    const slotsLeft = limits.maxFiles - files.length;
    const settledCount = files.filter((a) => a.status === "done" || a.status === "error").length;

    return (
      <div
        className="flex flex-col gap-3"
        onDragOver={(e) => {
          if (!canAddMore) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!canAddMore) return;
          e.preventDefault();
          setDragging(false);
          const dropped = Array.from(e.dataTransfer.files);
          const supported = dropped.filter((f) => ACCEPTED_EXTENSION.test(f.name));
          setDropNotice(supported.length < dropped.length ? "Only EPUB, PDF and DOCX files can be added — the rest were skipped." : null);
          handleFileChange(supported);
        }}
      >
        {fileInput}

        {files.length === 0 ? (
          <button
            type="button"
            onClick={openPicker}
            className={`group flex cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed bg-transparent px-6 py-16 text-center transition-colors ${dropzoneTone}`}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/10 text-brand-500 transition-transform group-hover:-translate-y-0.5">
              <CloudUpload size={26} />
            </span>
            <span>
              <span className="block text-[15px] font-bold text-[var(--reader-text)]">{dragging ? "Drop to upload" : "Drag books here"}</span>
              <span className="mt-1 block text-[13px] text-[var(--reader-text-muted)]">
                or <span className="font-semibold text-brand-500 underline-offset-2 group-hover:underline">browse your files</span>
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              {["EPUB", "PDF", "DOCX"].map((format) => (
                <span
                  key={format}
                  className="rounded-full border border-[var(--reader-border)] px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-[var(--reader-text-muted)]"
                >
                  {format}
                </span>
              ))}
            </span>
            <span className="text-[12px] text-[var(--reader-text-subtle)]">
              Up to {limits.maxFiles} files · {formatBytes(limits.maxFileSizeBytes)} file size limit
            </span>
          </button>
        ) : (
          <>
            {cards}
            {canAddMore && (
              <button
                type="button"
                onClick={openPicker}
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed bg-transparent py-4 text-[13px] font-semibold text-[var(--reader-text-muted)] transition-colors ${dropzoneTone}`}
              >
                <Plus size={16} />
                {dragging ? "Drop to add" : "Drop more books or browse"}
                <span className="font-medium text-[var(--reader-text-subtle)]">· {slotsLeft} left</span>
              </button>
            )}
          </>
        )}

        {dropNotice && (
          <p role="status" className="m-0 text-[12px] font-semibold text-[var(--reader-text-muted)]">
            {dropNotice}
          </p>
        )}

        {files.length > 0 && (
          <div className="sticky bottom-4 mt-2 flex items-center gap-4 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] px-4 py-3 shadow-sm">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[12px] font-semibold text-[var(--reader-text)]">
                {doneCount} of {files.length} uploaded
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--reader-surface-hover)]">
                <div
                  className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
                  style={{ width: `${(settledCount / files.length) * 100}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={flushAndClose}
              className="h-10 flex-none cursor-pointer rounded-[var(--radius-sm)] border-none bg-brand-500 px-5 text-[13px] font-bold text-white hover:bg-brand-600"
            >
              Done
            </button>
          </div>
        )}
      </div>
    );
  }

  const body = (
    <>
      <div className="flex flex-none items-center gap-2.5 border-b border-[var(--reader-border)] px-4 py-3">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-500/10">
          <Plus size={16} className="text-brand-500" />
        </div>
        <span className="text-[14px] font-bold text-[var(--reader-text)]">{editMaterial ? "Edit book" : "Add a book"}</span>
        <button
          onClick={flushAndClose}
          aria-label="Close"
          className="ml-auto flex-none cursor-pointer border-none bg-transparent p-0 text-[var(--reader-text-muted)]"
        >
          <X size={18} />
        </button>
      </div>

      {!editMaterial && fileInput}

      <div className="om-scroll min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-3">
          {files.length === 0 ? (
            <div
              onClick={() => inputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border-[1.5px] border-dashed border-[var(--reader-border)] py-12 text-[13px] font-semibold text-[var(--reader-text-muted)]"
            >
              <Plus size={22} />
              Add books
            </div>
          ) : (
            <>
              {cards}
              {canAddMore && addBooksButton}
            </>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <div className="flex flex-none items-center justify-between gap-3 border-t border-[var(--reader-border)] px-4 py-3">
          <span className="text-[12px] font-semibold text-[var(--reader-text-muted)]">
            {editMaterial ? "Changes save automatically" : `${doneCount} of ${files.length} uploaded`}
          </span>
          <button
            type="button"
            onClick={flushAndClose}
            className="h-10 w-full cursor-pointer rounded-[var(--radius-sm)] border-none bg-brand-500 px-5 text-[13px] font-bold text-white hover:bg-brand-600 sm:w-auto"
          >
            Done
          </button>
        </div>
      )}
    </>
  );

  if (typeof document === "undefined") return null;

  if (isDesktop) {
    return createPortal(
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) flushAndClose();
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
