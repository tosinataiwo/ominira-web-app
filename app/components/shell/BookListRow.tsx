"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Headphones, Lock, MoreVertical, Pencil, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useReadingPositionStore } from "@/stores/reading-position-store";
import type { MaterialSummary } from "@/lib/api/types";
import BookCover from "@/app/components/shared/BookCover";
import { PresenceLine } from "@/app/components/shared/CurrentReaders";
import { resolveBookCoverSrc, resolveBookThumbnailSrc } from "@/lib/materials/image";
import ReaderLink from "@/app/components/ReaderLink";
import AddBookModal from "@/app/components/shell/AddBookModal";
import { apiFetch } from "@/lib/api/client";
import { buildResumeHref, positionPercent } from "@/lib/reader/locator";
import type { CurrentReadingEntry } from "@/lib/api/types";
import { confirmAction } from "@/stores/confirm-store";

/**
 * List-row book tile — Claude Design "Library catalogue listing" project,
 * direction 1c ("Editorial tint"), since trimmed to just
 * title/author/progress (the description made the listing feel
 * overwhelming — a reader after it goes to the book's own detail page).
 * Shared by the Library catalogue, the Shelf page (ShelfView), and "My
 * uploads" (LibraryView's `view === "mine"`) — one row component for every
 * book list in the app, rather than a near-duplicate per list (the old
 * MyUploadRow). The only thing that changes per list is whether *this*
 * reader owns the book (`material.uploadedBy === currentReaderId`, passed
 * in by the caller, plus `onUpdated`/`onDeleted` to opt into owner actions
 * at all) — everything else (progress bar, presence line, cover/title) is
 * identical whether the row came from the shared catalog or "My uploads".
 *
 * Owner rows get a "..." (Edit/Delete) menu, same as before, and a small
 * lock badge — but only when the book is private ("Only you"); a public
 * upload shows no visibility indicator at all, since visibility is no
 * longer a quick-toggle here (dropped in favor of the Edit modal's own
 * Private/Share toggle, so there's exactly one place that changes it). That
 * badge plus the menu are the row's only interactive children besides the
 * cover/title links, which is why an owner row can't be one whole-row
 * `<Link>` the way a plain row is — HTML forbids nesting interactive
 * content inside an `<a>` — so its cover and title are each their own small
 * `<Link>`, with the menu as their sibling, never nested inside either.
 *
 * Covers here come from three inconsistent sources (own uploads,
 * OpenLibrary, Google — see lib/materials/image.ts) with wildly different
 * styles, which the old cover-tile grid made loud. The thin rust-tint
 * overlay pulls whatever's left toward one shared warm tone —
 * rgba(190,64,13,.16) is brand-500 (#be400d is rgb(190,64,13)) at 16%
 * opacity, multiplied over the art.
 *
 * The text column has no `items-start`, so it stretches to the row's full
 * height (the thumbnail's) and centers title/author/progress within that,
 * rather than pinning them to the top and leaving the tall thumbnail
 * towering over a short text block.
 */
/**
 * One row's progress readout — the percentage + bar + mode icon while still
 * in progress, or a single "Finished" line once done, in the same green
 * DocumentPreviewCard's own "done" state uses (--color-forest-500, with a
 * Check) rather than the in-progress accent color — a finished book is a
 * completed fact, not a percentage, so it gets that same settled treatment
 * instead of a 100%-full bar. No date here — the row is dense enough
 * already, and the exact date is one tap away on the material's own detail
 * page (MetaLine) and the end-of-document screen (DocumentEndPanel) for a
 * reader who actually wants it. A component because this row renders two
 * layout variants (compact and wide) that showed the same thing twice;
 * "Finished" in particular has to mean the same thing in both, and it isn't
 * a threshold on `pct` — it's the reader's own explicit mark (see
 * DocumentEndPanel).
 */
function ProgressLine({ pct, isFinished, wasListening }: { pct: number; isFinished: boolean; wasListening: boolean }) {
  if (isFinished) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-forest-500)]">
        <Check size={11} className="flex-none" />
        Finished
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* One shared bar whichever mode they were in — this icon is the only
          thing on the row that says which door clicking it reopens, without
          needing a second, listen-specific progress readout beside the
          reading one. It leads the line rather than trailing it: read
          left-to-right this now says "listening, 34%, [bar]" — the mode
          qualifies the number, so it belongs before it. Trailing (with an
          ml-auto pushing it past the bar's max-w-[160px] cap) left it
          floating alone in the leftover space of a wide row, detached from
          the thing it was describing. */}
      {wasListening && <Headphones size={12} className="flex-none text-[var(--reader-text-subtle)]" />}
      <span className="flex-none text-[11px] font-bold text-[var(--reader-accent)]">{pct}%</span>
      <span className="h-1 max-w-[160px] flex-1 overflow-hidden rounded-full bg-[var(--reader-border)]">
        <span className="block h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

type RowMenuItem = {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Destructive — red label, red hover. Reserved for acts that lose data for
   * everyone (owner Delete), never for "remove from *my* shelf", which loses
   * only a reading position and is undoable. */
  danger?: boolean;
};

/**
 * The row's "..." overflow menu — one implementation for both the places a
 * row grows actions: the owner's Edit/Delete, and the Shelf page's "Remove
 * from shelf". It used to be inlined in the owner branch only; a second copy
 * in the non-owner branch would have been two dropdowns to keep visually and
 * behaviourally identical, so it moved out here instead.
 *
 * Owns its own open state and outside-click dismissal, which is why it's a
 * component rather than a render helper — the alternative was one `menuOpen`
 * in BookListRow shared by two branches that never render at the same time.
 *
 * Always at full opacity rather than hover-revealed. A menu is the row's escape hatch: a reader looking for "how
 * do I get rid of this" has to be able to *see* that there's somewhere to
 * look, and on touch there's no hover to discover it with. It stays quiet by
 * being a small muted glyph, not by hiding.
 */
function RowMenu({ items, className = "" }: { items: RowMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutsideClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, [open]);

  return (
    <div ref={ref} className={`absolute right-0 top-3 z-10 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Book options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 text-[var(--reader-text-subtle)] hover:bg-[var(--reader-surface-hover)] hover:text-[var(--reader-text-muted)]"
      >
        <MoreVertical size={13} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--reader-border)] bg-[var(--reader-surface)] py-1 shadow-lg"
        >
          {items.map(({ label, icon: Icon, onSelect, danger }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                // Closed before the action runs, so anything that opens a
                // modal or a window.confirm on top of this doesn't leave the
                // dropdown hanging open behind it.
                setOpen(false);
                onSelect();
              }}
              className={`flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2 text-left text-[12px] font-semibold ${
                danger ? "text-red-600 hover:bg-red-50" : "text-[var(--reader-text)] hover:bg-[var(--reader-surface-hover)]"
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BookListRow({
  material,
  resumeTarget,
  selection,
  categories,
  currentReaderId,
  onRemove,
  onUpdated,
  onDeleted,
}: {
  material: MaterialSummary;
  /** Shelf page only (ShelfView's Reading and Finished tabs) — every row
   * there is already this reader's own real reader_activities entry (GET
   * /continue-reading), so
   * the row skips book-detail entirely and goes straight into the reader at
   * that exact section/passage, the same URL-based handoff
   * BookDetailView's own "Resume reading" and ContinueReadingItemCard use
   * (see useResumeScroll's doc comment for why the URL, not a client store
   * read on arrival, is what carries this). Absent everywhere else (the
   * Library catalogue) — those rows are for *browsing*, where the detail
   * page's blurb/outline/CTA is still the right landing spot, most of them
   * not even started yet. */
  resumeTarget?: Pick<CurrentReadingEntry, "locator" | "mode">;
  /** SurveyWizard's "which of these have you read?" step only — renders this
   * row as a toggleable checkbox tile instead of a navigating link, and
   * skips resumeTarget/progress/presence/owner-actions entirely (irrelevant
   * to "have you ever read this", and this step runs before there's even an
   * authenticated reader for any of that to apply to). Mutually exclusive
   * with resumeTarget and owner actions. */
  selection?: { selected: boolean; onToggle: () => void };
  /** AddBookModal's (edit mode) category picker, for owner rows only — the caller's
   * full category list for this library (library-contribution-ux-spec.md). */
  categories?: string[];
  /** This viewer's own reader id (useProfile().data.id) — a row renders its
   * owner "..." menu only when this matches `material.uploadedBy` *and*
   * `onDeleted` is supplied, so passing an id alone (e.g. from a page that
   * doesn't wire up edit/delete) doesn't turn on owner UI by accident. */
  currentReaderId?: string | null;
  /** Shelf page's tabs — renders a quiet inline "Remove" beside the row's
   * status text (Only you, Finished, …). Only ever removes from *this
   * reader's* shelf/saved list, never deletes the material, so it's separate
   * from `onDeleted` (owner delete, behind the "..." menu and a confirm) and
   * has no confirm of its own. */
  onRemove?: () => void;
  onUpdated?: (updated: Pick<MaterialSummary, "id" | "title" | "author" | "visibility" | "categories" | "coverSource">) => void;
  onDeleted?: (id: string) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const position = useReadingPositionStore((s) => s.positions[material.id]);
  // positionPercent, not progressPercent: a finished material reads 100 here
  // and nowhere else could, since tracked progress can't reach it (see
  // lib/reader/locator.ts).
  const pct = positionPercent(position);
  const isFinished = Boolean(position?.finishedAt);
  const showProgress = !selection && pct > 0;
  const isOwner = !selection && !!onDeleted && !!currentReaderId && material.uploadedBy === currentReaderId;
  const isPrivate = material.visibility === "personal";
  // `mode` on this row's own reader_activities entry is what sends a reader
  // who was listening back through the listening door (buildResumeHref adds
  // `listen=1`) instead of always dropping them back into text.
  const wasListening = resumeTarget?.mode === "listen";
  const href = resumeTarget ? buildResumeHref(material.slug, resumeTarget) : `/library/${material.slug}`;
  const className = `group flex min-w-0 gap-4 border-b border-[var(--reader-border)] py-4 no-underline ${
    selection ? `cursor-pointer rounded-xs px-2 text-left transition-colors ${selection.selected ? "bg-brand-50/40" : ""}` : ""
  }`;

  async function deleteNow() {
    const ok = await confirmAction({ title: `Delete "${material.title}"?`, message: "This can't be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await apiFetch(`/materials/${material.id}`, { method: "DELETE" });
    onDeleted?.(material.id);
  }

  // Bookmarking lives only on the material's detail page (and posts); a row
  // just offers a quiet "Remove" (shelf / saved) inline with its status text.
  const removeLink = onRemove && (
    <button
      type="button"
      onClick={onRemove}
      className="relative z-10 cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-[var(--reader-text-subtle)] hover:text-red-600 hover:underline"
    >
      Remove
    </button>
  );
  const privateBadge = isPrivate && (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[var(--reader-text-subtle)]">
      <Lock size={11} />
      Only you
    </span>
  );
  const hasExtras = Boolean(privateBadge || removeLink);
  // Progress bar on its own line; "Finished" is short enough to share the
  // line with the extras. Only-you/Remove follow on the next line otherwise.
  const statusRow = (showProgress || hasExtras) && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {showProgress && (
        <div className={isFinished ? "" : "w-full"}>
          <ProgressLine pct={pct} isFinished={isFinished} wasListening={wasListening} />
        </div>
      )}
      {privateBadge}
      {removeLink}
    </div>
  );

  // Order is reach: edit the book, take it off your own shelf, then destroy
  // it for everyone — least to most consequential, with the only irreversible
  // one last and red.
  const ownerItems: RowMenuItem[] = [
    { label: "Edit", icon: Pencil, onSelect: () => setEditOpen(true) },
    { label: "Delete", icon: Trash2, onSelect: deleteNow, danger: true },
  ];

  const cover = (
    <div className="relative h-28 w-20 flex-none overflow-hidden rounded-xs">
      {/* Selection mode (SurveyWizard) asks for the widest-variant cover,
          not the compact-list thumbnail every other row here uses — this
          tile is the main thing on the screen, not a dense list item. */}
      <BookCover materialType={material.materialType}
        src={selection ? resolveBookCoverSrc(material) : resolveBookThumbnailSrc(material)}
        alt={material.title}
        className="h-full w-full"
        iconSize={22}
      />
      <div className="cover-tint" />
    </div>
  );

  const textColumn = (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
      <div className="font-serif text-[14px] font-semibold leading-tight text-[var(--reader-text)] group-hover:text-brand-500">
        {material.title}
      </div>
      <div className="text-[11px] font-semibold capitalize tracking-[0.04em] text-[var(--reader-text-muted)]">
        {material.author}
      </div>
      {!selection && statusRow}
      {!selection && <PresenceLine readers={material.currentReaders} totalCount={material.currentReaderCount} />}
    </div>
  );

  if (selection) {
    return (
      <button type="button" onClick={selection.onToggle} className={className}>
        {cover}
        {textColumn}
        <div
          aria-hidden="true"
          className={`flex h-6 w-6 flex-none items-center justify-center self-center rounded-full border-2 transition-colors ${
            selection.selected
              ? "border-brand-500 bg-brand-500"
              : "border-[var(--reader-border)] bg-[var(--reader-surface)]"
          }`}
        >
          {selection.selected && <Check size={14} strokeWidth={3} className="text-white" />}
        </div>
      </button>
    );
  }

  if (isOwner) {
    return (
      <div className="group relative flex min-w-0 gap-4 border-b border-[var(--reader-border)] py-4">
        {editOpen && (
          <AddBookModal
            categories={categories ?? []}
            editMaterial={material}
            onClose={() => setEditOpen(false)}
            onMaterialSaved={(updated) => onUpdated?.(updated)}
            onMaterialDeleted={(id) => onDeleted?.(id)}
          />
        )}

        <Link href={href} className="relative h-28 w-20 flex-none overflow-hidden rounded-xs">
          <BookCover materialType={material.materialType} src={resolveBookThumbnailSrc(material)} alt={material.title} className="h-full w-full" iconSize={22} />
          <div className="cover-tint" />
        </Link>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <Link
            href={href}
            className="min-w-0 pr-5 font-serif text-[14px] font-semibold leading-tight text-[var(--reader-text)] no-underline hover:text-brand-500"
          >
            {material.title}
          </Link>
          <RowMenu items={ownerItems} />
          <div className="text-[11px] font-semibold capitalize tracking-[0.04em] text-[var(--reader-text-muted)]">
            {material.author}
          </div>
          {statusRow}
          <PresenceLine readers={material.currentReaders} totalCount={material.currentReaderCount} />
        </div>
      </div>
    );
  }

  // ReaderLink (a plain <a>, never next/link's <Link>) once this is headed
  // into /read/[slug] — the (.)read/[slug] modal interception fires for ANY
  // client-side Link navigation there regardless of origin (see ReaderLink's
  // own doc comment), which would otherwise pop this up as an overlay on top
  // of the Reading page instead of the real standalone reader.
  const LinkComponent = resumeTarget ? ReaderLink : Link;

  // A "stretched link": the row is a plain <div>, and the navigation is one
  // absolutely-positioned empty <a> filling it, with the trailing controls as
  // siblings stacked above. The row used to *be* the <a>, wrapping cover
  // and text — but HTML forbids nesting a <button> inside an <a>, the same
  // constraint the owner branch above calls out and solves by splitting the
  // row into several small links instead. Splitting this one the same way
  // would have cost the whole-row tap target, which on mobile is most of
  // what makes this list usable; the overlay keeps it. The link is empty
  // and carries the title as its accessible name, since the real title text
  // lives outside it.
  return (
    <div className={`relative ${className}`}>
      <LinkComponent href={href} aria-label={material.title} className="absolute inset-0 z-0" />
      {cover}
      {textColumn}
    </div>
  );
}
