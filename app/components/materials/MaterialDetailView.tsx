"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronDown, ChevronRight, Headphones, Play } from "lucide-react";
import type { MaterialDetail } from "@/lib/materials/detail";
import { buildTocOutlineRows } from "@/lib/reader/tocOutline";
import { useReadingPositionStore } from "@/stores/reading-position-store";
import { useServerPositionReady } from "@/lib/reader/useServerPositionReady";
import { buildResumeHref, locatorOfKind, positionPercent } from "@/lib/reader/locator";
import { useBookCommunityNotes } from "@/lib/materials/useBookCommunityNotes";
import { useMaterialReaction } from "@/lib/materials/useMaterialReaction";
import { comradeName } from "@/lib/reader/authorDisplay";
import { pseudonymToSlug } from "@/lib/reader/profileSlug";
import BookCover from "@/app/components/shared/BookCover";
import ReaderAvatar from "@/app/components/shared/ReaderAvatar";
import { ReadingNowMetaItem, ReadingRoomModal } from "@/app/components/shared/CurrentReaders";
import LiveChip from "@/app/components/room/LiveChip";
import { resolveBookCoverSrc } from "@/lib/materials/image";
import PulseDot from "@/app/components/shared/PulseDot";
import NoteCard from "@/app/components/reader/notes/NoteCard";
import ReactionButton from "@/app/components/reader/notes/ReactionButton";
import BookmarkButton from "@/app/components/shared/BookmarkButton";
import { useBookmarkedMaterialIds, useToggleMaterialBookmark } from "@/lib/bookmarks/useBookmarks";
import { useProfile } from "@/lib/auth/useProfile";
import DetailHeader from "@/app/components/shared/DetailHeader";
import NoResults from "@/app/components/shared/NoResults";
import ReaderLink from "../ReaderLink";
import Tooltip from "../reader/Tooltip";

/**
 * TOC and Community Notes used to be an underline tab pair — redundant once
 * not every material has a table of contents (a plain PDF/webpage/docx
 * upload has neither `sections` nor much reason to force a tab switch for a
 * feed that's either empty or the only thing worth showing). Stacked,
 * independently expandable sections instead: each owns its own open/closed
 * state and chevron, so a material with no TOC just shows Notes with
 * nothing above it, rather than an empty first tab. */
function ExpandableSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent py-4 text-left"
        aria-expanded={open}
      >
        <span className="text-[14px] font-bold text-[var(--reader-text)]">{title}</span>
        <ChevronDown
          size={18}
          className={`flex-none text-[var(--reader-text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="pb-6">{children}</div>}
    </div>
  );
}

/**
 * Every row — including a numbered sub-heading that has both its own
 * lead-in passages *and* children (e.g. "2.4.1 Some historical myths...",
 * itself parent to "A.", "B.", ...) — is independently clickable: `isGroup`
 * only picks the row's typography (a bold section head vs. a plain leaf),
 * never whether it links anywhere. The link always points at the section's
 * own id; `/read/[slug]`'s resolveSpineTarget (lib/reader/sections.ts) is
 * what lands a click on real content — itself if it has passages, otherwise
 * the nearest one after it — so a pure grouping node with no passages of
 * its own (a true "Part" divider) still goes somewhere sensible instead of
 * being inert. This is the same `buildTocOutlineRows` the reader's own
 * ChaptersDrawer flattens its sidebar from (lib/reader/tocOutline.ts) —
 * one shared algorithm, so the book-detail outline and the in-reader
 * drawer can't drift into different notions of the same book's contents.
 */
function OutlineTab({ material, currentSectionId }: { material: MaterialDetail; currentSectionId?: string }) {
  const rows = buildTocOutlineRows(material.sections);
  if (rows.length === 0) return null;

  return (
    <div className="rounded-sm border border-[var(--reader-border)] bg-[var(--reader-surface)] p-4">
      <div className="flex flex-col divide-y divide-[var(--reader-border)]">
        {rows.map(({ section, depth, isGroup }) => {
          // Exact match only — reader_activities.section_id is always one
          // real spine entry (never a pure grouping label with no passages
          // of its own), so there's no walk-forward-to-the-nearest-real-
          // section to do here the way resolveSpineTarget does for a click;
          // this is just "is this the row the reader's own position names."
          const isCurrent = section.id === currentSectionId;
          return isGroup ? (
            <ReaderLink
              key={section.id}
              href={`/read/${material.slug}?section=${section.id}`}
              style={{ paddingLeft: depth * 20 }}
              className={`block w-full pt-4 pb-1.5 text-[13.5px] font-semibold no-underline first:pt-0 hover:text-brand-500 ${isCurrent ? "text-brand-500" : "text-[var(--reader-text)]"}`}
            >
              {section.label}
            </ReaderLink>
          ) : (
            <ReaderLink
              key={section.id}
              href={`/read/${material.slug}?section=${section.id}`}
              style={{ paddingLeft: depth * 20 }}
              className={`group flex w-full items-center gap-3 py-2.5 pr-1 no-underline transition-colors hover:bg-[var(--reader-surface-hover)]`}
            >
              <span
                className={`min-w-0 flex-1 truncate text-[13.5px] font-medium transition-colors group-hover:text-[var(--reader-text)] ${isCurrent ? "font-semibold text-brand-500" : "text-[var(--reader-text-muted)]"}`}
              >
                {section.label}
              </span>
              {isCurrent && <PulseDot />}
              <ChevronRight
                size={14}
                className="flex-none text-[var(--reader-text-subtle)] transition-colors group-hover:text-[var(--reader-text-muted)] group-hover:translate-x-0.5"
              />
            </ReaderLink>
          );
        })}
      </div>
    </div>
  );
}

function NotesTab({ materialId }: { materialId: string }) {
  // No sort toggle here — "top" (highest-reacted first) is the one useful
  // default for a book-scoped feed this size; a Top/Recent switch was
  // redundant weight next to the outline/notes tab switch directly above it.
  const { data, isLoading } = useBookCommunityNotes(materialId, "top");
  const items = data?.items ?? [];

  if (isLoading) {
    return <p className="mt-1 mb-0 font-bold text-sm text-[var(--reader-text-muted)]">Loading notes…</p>;
  }
  if (items.length === 0) {
    return <NoResults className="mt-1 mb-0 font-bold" message="No community notes on this material yet" />;
  }

  return (
    <div className="flex flex-col">
      {items.map((item) => (
        <NoteCard key={item.note.id} materialId={materialId} note={item.note} replies={item.replies} excerpt={item.excerpt} />
      ))}
    </div>
  );
}

// Library-only material types (see lib/materials/list.ts's own
// LIBRARY_MATERIAL_TYPES comment — "webpage" never reaches this detail
// page) get a plain-English label here; an unrecognized type just omits
// the fact rather than showing a raw DB value like "docx".
const FORMAT_LABEL: Record<string, string> = {
  book: "EPUB",
  pdf: "PDF",
  docx: "Word document",
};

/** Published year / page count / audiobook availability / who's reading
 * this right now, as a single dot-separated byline rather than a row of
 * bordered chips — a book's facts read as editorial metadata (the way a
 * magazine masthead or a library catalog card sets them), not as UI
 * controls, which is what a bordered pill implied even with no fill.
 * Audiobook and "reading now" each get a small brand-colored accent — the
 * two deliberate points of color in an otherwise quiet, all-text line;
 * everything else stays plain. "Reading now" is the one interactive fact
 * here (see ReadingNowMetaItem) — clicking it is what opens ReadingRoomModal;
 * that open state is lifted to BookDetailView because the modal itself
 * renders at the page's own top level, not nested under this line. */
function MetaLine({
  material,
  hasNarration,
  onOpenReaders,
  action,
}: {
  material: MaterialDetail;
  hasNarration: boolean;
  onOpenReaders: () => void;
  /** Icon-only control (the bookmark) shown beside "reading now". */
  action?: React.ReactNode;
}) {
  const parts: { key: string; node: React.ReactNode }[] = [];
  const formatLabel = FORMAT_LABEL[material.materialType];
  if (formatLabel) parts.push({ key: "format", node: <span>{formatLabel}</span> });
  if (material.publishedYear) parts.push({ key: "year", node: <span>{material.publishedYear}</span> });
  if (material.pageCountEstimate) parts.push({ key: "pages", node: <span>{material.pageCountEstimate} pages</span> });
  if (hasNarration) {
    parts.push({
      key: "audio",
      node: (
        <span className="inline-flex items-center gap-1 text-brand-500">
          <Headphones size={12} />
          Audiobook
        </span>
      ),
    });
  }
  // "Reading now" gets its own row below the plain facts above — it's the
  // one interactive, ever-changing fact here (see this component's own doc
  // comment), and folding it into the same dot-separated line as format/
  // year/pages/audiobook made for a crowded single row that read as one
  // undifferentiated wall of facts instead of "the book's own stats" plus
  // "who's here right now."
  const readingNow =
    material.currentReaders.length > 0 ? (
      <ReadingNowMetaItem readers={material.currentReaders} totalCount={material.currentReaderCount} onOpen={onOpenReaders} />
    ) : null;
  if (parts.length === 0 && !readingNow && !action) return null;

  return (
    <div className="mt-2.5 flex flex-col items-center gap-1.5 text-[13px] font-medium text-[var(--reader-text-subtle)]">
      {parts.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-x-2">
          {parts.map((part, i) => (
            <span key={part.key} className="inline-flex items-center gap-2">
              {i > 0 && <span aria-hidden="true">·</span>}
              {part.node}
            </span>
          ))}
        </div>
      )}
      {(readingNow || action) && (
        <div className="flex items-center justify-center gap-2">
          {readingNow}
          {action}
        </div>
      )}
    </div>
  );
}

function BookDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  // Whether line-clamp-6 is actually cutting text is a function of rendered layout
  // (container width, word lengths, real line breaks) — a character-count guess got
  // this wrong both ways (a "Show more" with nothing more to show; a long single-line
  // blurb with no button at all). Measure the real thing instead: scrollHeight only
  // exceeds clientHeight while the clamp class is genuinely truncating something.
  const [isTruncated, setIsTruncated] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measured once while still clamped (expanded starts false) — not re-run on
    // `expanded` toggles, so the button's presence doesn't flip-flop as the element's
    // own clamping turns on and off.
    setIsTruncated(el.scrollHeight > el.clientHeight + 1); // +1: subpixel rounding guard
  }, [text]);

  return (
    // text-left: the block itself sits centered with everything else in the
    // hero (BookDetailView's own wrapping column), but a paragraph read as
    // centered prose, not the block's position, is the part that's genuinely
    // harder to read — this stays left-aligned regardless of that ancestor.
    <div className="mt-4 text-left">
      <p
        ref={ref}
        className={`text-sm font-medium leading-6 text-[var(--reader-text-muted)] ${!expanded ? "line-clamp-6" : ""}`}
      >
        {text}
      </p>
      {isTruncated && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 border-none bg-transparent p-0 text-sm font-semibold text-brand-500 cursor-pointer hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** "Added by {name}" credit row (library-contribution-ux-spec.md Step 5) —
 * only rendered for a reader-contributed material (`material.contributor`
 * null for editorial catalogue rows). Sits bordered top+bottom, directly
 * above the description, with the appreciation ReactionButton at its
 * trailing edge — the one place on this page both "who shared this" and
 * "thank them for it" live together. */
function ContributorRow({ material }: { material: MaterialDetail }) {
  const reaction = useMaterialReaction(material.id);
  const [reactedByMe, setReactedByMe] = useState(false);
  const [reactionCount, setReactionCount] = useState(material.reactionCount);

  if (!material.contributor) return null;
  const displayName = comradeName(material.contributor.pseudonym);
  const profileHref = `/@${pseudonymToSlug(material.contributor.pseudonym)}`;

  const handleToggle = () => {
    const wasReacted = reactedByMe;
    setReactedByMe(!wasReacted);
    setReactionCount((c) => c + (wasReacted ? -1 : 1));
    reaction.mutate(undefined, {
      onError: () => {
        setReactedByMe(wasReacted);
        setReactionCount((c) => c + (wasReacted ? 1 : -1));
      },
      onSuccess: (data) => {
        setReactedByMe(data.reactedByMe);
        setReactionCount(data.reactionCount);
      },
    });
  };

  return (
    <div className="mt-6 flex items-center gap-3 border-y border-[var(--reader-border)] py-3.5 text-left">
      <Link href={profileHref} className="flex flex-none no-underline">
        <ReaderAvatar pseudonym={material.contributor.pseudonym} avatar={material.contributor.avatar} size={32} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-[var(--reader-text-subtle)]">Added by</div>
        <Link href={profileHref} className="truncate text-[13px] font-semibold text-[var(--reader-text)] no-underline hover:underline">
          {displayName}
        </Link>
      </div>
      <ReactionButton count={reactionCount} reacted={reactedByMe} onToggle={handleToggle} size="small" />
    </div>
  );
}

/**
 * A material's "profile page": cover, title/author/facts/progress/CTAs
 * sitting directly on the page background (no card, no backdrop panel
 * behind it — the cover art itself already carries the visual interest),
 * a contributor credit row, then two independently expandable sections
 * (table of contents, community notes) stacked below it — TOC first, only
 * shown at all when the material actually has one (see ExpandableSection's
 * own doc comment). This is the one page a reader is likeliest to land on
 * cold from a shared link, so the whole header reads as one deliberate,
 * continuous unit rather than a stack of separately-boxed widgets.
 *
 * Served entirely from `materials.detail`'s DB-only fields (api-spec.md's
 * own worked example for this exact page) — no `BookDocument`, no Storage
 * round trip for the hero/outline. The notes section's own fetch
 * (useBookCommunityNotes) is the one thing on this page that does touch
 * Storage (for each note's quoted excerpt), and only once that section is
 * actually expanded.
 */
export default function MaterialDetailView({ material }: { material: MaterialDetail }) {
  // Also seeds the position mirror for a reader who lands straight on this
  // page (a shared link, a search-engine hit) without ever visiting /home
  // first, and gates every position-dependent thing below on the server's own
  // row having had its chance to correct that mirror — without it, a reader
  // could click "Resume reading" against whatever this device happened to
  // hold right after login. See the hook's own doc comment.
  const positionReady = useServerPositionReady();
  const position = useReadingPositionStore((s) => s.positions[material.id]);
  // positionPercent, not progressPercent: tracked progress can't reach 100 (it
  // divides an index by a count), so a full bar here means the reader actually
  // marked this finished in the reader's own end panel — see
  // lib/reader/locator.ts and DocumentEndPanel.
  const pct = positionPercent(position);
  const finishedAt = position?.finishedAt ?? null;
  // Hands the reader's own real reader_activities row straight through the
  // URL rather than making the reader page ask this device's local mirror to
  // reconstruct it — that mirror is exactly what could be stale, which is
  // what used to land "Resume reading" on the right chapter but its very
  // first passage. See buildResumeHref and useResumeScroll's doc comments.
  // Format-agnostic: the locator carries a page or a block just as readily as
  // a section/passage, so a PDF or an article resumes through the same link.
  const readHref = position ? buildResumeHref(material.slug, { ...position, mode: "read" }) : `/read/${material.slug}`;
  const listenHref = position
    ? buildResumeHref(material.slug, { ...position, mode: "listen" })
    : `/read/${material.slug}?listen=1`;
  const [readersOpen, setReadersOpen] = useState(false);

  // Gates the "Audiobook" badge only — a claim about real prerecorded
  // narration. The Listen CTA below isn't gated on this: NarrationEngine
  // falls back to live, on-demand AI narration for any book without one.
  const hasRecordedAudiobook = material.narratorCount > 0;
  // One shared resume record for both reading and listening (see
  // stores/reading-position-store.ts's Position type), carrying the mode that
  // last wrote it — which is exactly the signal the two CTAs below need to
  // stop reading as two unrelated "have I started" states over one shared
  // bookmark.
  const lastModeWasListen = position?.mode === "listen";
  const rows = buildTocOutlineRows(material.sections);
  const hasToc = rows.length > 0;
  const router = useRouter();

  // Read off the same shared id set every book row in the app uses, rather
  // than a `bookmarkedByMe` on MaterialDetail — this page is server-
  // rendered from getMaterialDetail, which has no caller identity, exactly
  // the asymmetry the ids route's own doc comment describes.
  const { data: profile } = useProfile();
  const isSaved = useBookmarkedMaterialIds().has(material.id);
  const toggleBookmark = useToggleMaterialBookmark();
  // Same rule-1 suppression BookListRow applies — you don't save your own
  // upload; it's already yours, and already in your personal library.
  // `contributor.readerId` IS the material's uploaded_by (see
  // MaterialContributor) — null for an editorial catalogue book, which is
  // nobody's own upload and so always savable.
  const isOwnUpload = !!material.contributor && material.contributor.readerId === profile?.id;

  return (
    <div className="pb-12 shell:mx-auto shell:max-w-4xl">
      <DetailHeader
        onBack={() => (window.history.length > 1 ? router.back() : router.push("/"))}
        shareAction={{ title: material.title, text: `${material.title} by ${material.author}` }}
      />

      <div className="mb-8 flex flex-col items-center gap-5">
        {/* One full-width column at every breakpoint now, not a side-by-side
            split above `shell:` — a two-column hero read fine narrow but
            put the cover and a wide text column awkwardly far apart once
            the page had real width to work with. Centering the cover on
            its own line, with everything else stacked at full width below
            it (title through the CTAs), reads as one deliberate column
            instead of two columns fighting for the same row. */}
        <BookCover materialType={material.materialType}
          src={resolveBookCoverSrc(material)}
          alt={material.title}
          className="aspect-[2/3] w-48 shell:w-56 flex-none shadow-lg"
        />
        {/* max-w-lg, not the cover's own w-56 — a book's title/description
            need noticeably more measure than the cover to read as text, so
            this column is deliberately wider than the image sitting above
            it, just still narrower than the page (and centered within it)
            rather than stretching to the full shell width the two-column
            layout used to fill. text-center here is the one shared switch
            for title/author/metadata — BookDescription opts itself back to
            text-left (see its own comment): a centered *block* reads fine,
            centered *prose* doesn't. */}
        <div className="mx-auto w-full max-w-[640px] min-w-0 text-center">
          <h1 className="font-serif type-1 text-balance text-[var(--reader-text)]">
            {material.title}
          </h1>
          <div className="mt-2 text-sm font-medium text-[var(--reader-text-muted)]">{material.author}</div>

          <MetaLine
            material={material}
            hasNarration={hasRecordedAudiobook}
            onOpenReaders={() => setReadersOpen(true)}
            // Beside "reading now": icon-only, brand-filled once saved.
            // Hidden for the reader's own upload, which is already theirs.
            action={
              isOwnUpload ? undefined : (
                <Tooltip label="Save for later">
                  <BookmarkButton saved={isSaved} onToggle={() => toggleBookmark.mutate(material.id)} />
                </Tooltip>
              )
            }
          />

          <LiveChip materialId={material.id} className="mt-3" />

          <ContributorRow material={material} />

          {/* Google first, OpenLibrary as backup — material.description (first-party)
              is left out of this cascade for now, it isn't reliably populated. */}
          {(material.googleDescription ?? material.openlibraryDescription) && (
            <BookDescription text={(material.googleDescription ?? material.openlibraryDescription)!} />
          )}

          {/* Neither the progress bar nor the CTA below commits to a real
              number/label until positionReady — showing a stale/default
              "Start reading" (or the wrong % complete) for the instant
              before GET /continue-reading lands would be as misleading as
              the wrong-passage bug this whole flow exists to avoid, just
              one step earlier. A skeleton pulse in the same footprint below
              is a deliberately brief, layout-stable stand-in — this only
              shows at all when a real position is plausible (pct or a
              locally-hydrated position already say so) rather than every
              page load. */}
          {!positionReady && (pct > 0 || position) && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <div className="h-1 flex-1 animate-pulse overflow-hidden rounded-full bg-[var(--reader-surface-hover)]" />
              <span className="flex-none text-xs font-semibold text-transparent">0% complete</span>
            </div>
          )}
          {positionReady && pct > 0 && (
            <div className="mt-4 flex flex-col items-center gap-1.5">
              <div className="flex w-full items-center justify-center gap-3">
                {/* --reader-surface is literally the same value as --reader-bg
                    in both themes (see globals.css) — invisible as a track
                    color now that this hero sits directly on the page
                    background rather than its own tinted panel.
                    --reader-surface-hover is the token actually built to read
                    as a filled element against a flat bg in either theme. */}
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--reader-surface-hover)]">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="flex-none text-xs font-semibold text-[var(--reader-text-muted)]">{pct}% complete</span>
              </div>
              {/* One shared bar, one shared bookmark (see lastModeWasListen's
                  own comment) — this is the one place that says so out loud,
                  so "left off listening" doesn't read as a second, competing
                  progress state next to the Read/Listen buttons below it. */}
              <span className="text-[11px] font-medium text-[var(--reader-text-subtle)]">
                {finishedAt
                  ? `Finished ${new Date(finishedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
                  : `Left off ${lastModeWasListen ? "listening" : "reading"}`}
              </span>
            </div>
          )}

          {/* One primary CTA, not two competing "continue" buttons — it
              follows whichever mode this reader was last in (or Read, before
              any position exists), and the small square icon button next to
              it is purely a mode *switch*, not a second equally-weighted
              action. Same pattern Audible/Kindle/Spotify audiobooks use for
              a book that has both a text and an audio thread: one resume
              action, one low-emphasis way to jump to the other thread. */}
          <div className="mt-5 flex items-center justify-center gap-2">
            {positionReady ? (
              <ReaderLink
                href={lastModeWasListen ? listenHref : readHref}
                className="flex flex-1 items-center justify-center gap-2 rounded-sm bg-brand-500 px-6 py-2.5 text-center text-sm font-semibold text-white no-underline shell:flex-none hover:bg-brand-600"
              >
                {lastModeWasListen && <Play size={16} />}
                {/* A finished material reopens as "again" rather than
                    "continue" — the saved locator still resumes exactly where
                    they stopped, but calling that "continue" would contradict
                    the Finished state right above it. */}
                {finishedAt
                  ? lastModeWasListen
                    ? "Listen again"
                    : "Read again"
                  : lastModeWasListen
                    ? "Continue listening"
                    : pct > 0
                      ? "Continue reading"
                      : "Start reading"}
              </ReaderLink>
            ) : (
              // Same footprint as the real CTA, deliberately non-navigable —
              // a click here before the server position lands is exactly
              // the click that could otherwise walk off with a stale/
              // inaccurate URL (see positionReady's own comment above).
              <div
                aria-hidden="true"
                className="flex-1 animate-pulse rounded-sm bg-[var(--reader-surface-hover)] px-6 py-2.5 text-center text-sm font-semibold text-transparent shell:flex-none"
              >
                Start reading
              </div>
            )}

            {/* ?listen=1 rather than calling openBook(book) directly — this
                is a real navigation (ReaderLink), and audio-store's `book`
                field isn't persisted (only `speed` is), so setting it
                before the page unloads would just lose it. Reader.tsx
                picks the flag up on mount and calls openBook itself
                instead, the same handoff targetSectionId/targetPassageId
                already do for "jump to this chapter"/"open this note"
                links. Unconditional now — no book is without at least
                live AI narration. Icon-only, deliberately lower-emphasis
                than the primary CTA: this is "switch mode," not a second
                thing to do — the label moves into Tooltip (this project's
                own shared reader-icon-button tooltip, see its doc comment)
                instead of a visible second string competing with the CTA. */}
            <Tooltip label={lastModeWasListen ? "Switch to reading" : hasRecordedAudiobook ? "Listen (audiobook)" : "Listen"}>
              <ReaderLink
                href={lastModeWasListen ? readHref : listenHref}
                aria-label={lastModeWasListen ? "Switch to reading" : hasRecordedAudiobook ? "Listen (audiobook)" : "Listen"}
                className="flex flex-none cursor-pointer items-center justify-center rounded-sm border border-[var(--reader-border)] bg-transparent p-2.5 text-[var(--reader-text)] no-underline hover:bg-[var(--reader-surface)]"
              >
                {lastModeWasListen ? <BookOpen size={18} /> : <Headphones size={18} />}
              </ReaderLink>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* A modal (SearchModal's own chrome), not an inline section pushed
          into the hero above — only mounted at all once the "reading now"
          fact in MetaLine is clicked open (see CurrentReaders.tsx's own
          doc comment on why this moved off the page's own flow). */}
      {readersOpen && (
        <div className="fixed inset-0 z-50">
          <ReadingRoomModal
            readers={material.currentReaders}
            totalCount={material.currentReaderCount}
            onClose={() => setReadersOpen(false)}
          />
        </div>
      )}

      <div className="mx-auto flex w-full max-w-[640px] flex-col">
        {hasToc && (
          <ExpandableSection title="Table of contents" defaultOpen={false}>
            {/* Only once positionReady — same reasoning as the CTA/progress
                bar above: a locally-stale position highlighting the wrong
                chapter for a moment is exactly the kind of "confidently
                wrong" this page is trying to stop doing. */}
            <OutlineTab material={material} currentSectionId={positionReady ? locatorOfKind(position?.locator, "epub")?.sectionId : undefined} />
          </ExpandableSection>
        )}
        <ExpandableSection title="Community notes" defaultOpen={false}>
          <NotesTab materialId={material.id} />
        </ExpandableSection>
      </div>
    </div>
  );
}
