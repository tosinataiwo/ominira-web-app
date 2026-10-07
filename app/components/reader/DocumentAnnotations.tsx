"use client";

import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Copy, Highlighter, MessageCircle, MessageSquareQuote, Trash2 } from "lucide-react";
import type { SelectionSurface } from "@/lib/annotations/surface";
import { useTextSelection } from "@/lib/annotations/useTextSelection";
import { quoteForRanges } from "@/lib/reader/annotationSelection";
import type { FeedEntry, FeedLocator } from "@/lib/reader/annotationFeed";
import { useBookAnnotationFeed } from "@/lib/reader/useBookAnnotationFeed";
import { useShareToRoom } from "@/lib/room/sharePassage";
import { useScrollChrome } from "@/lib/reader/useScrollChrome";
import { PENDING_ANNOTATION_ID, useTextAnnotations } from "@/lib/reader/useTextAnnotations";
import { useReaderStore } from "@/stores/reader-store";
import { useSessionStore } from "@/stores/session-store";
import type { Annotation } from "@/stores/library-store";
import MembersOnlyPrompt from "./notes/MembersOnlyPrompt";
import BookAnnotationFeedPanel from "./notes/BookAnnotationFeedPanel";
import NotesFeedFab from "./NotesFeedFab";
import NotesSidebar from "./NotesSidebar";
import SelectionMenu, { type Item } from "./SelectionMenu";

const NARROW_QUERY = "(max-width: 859px)";
/** The phone/desktop split every reader uses (useSectionCarousel's 860px) —
 * picks the bottom-bar menu and the bottom-sheet notes panel. */
export function useNarrowViewport() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(NARROW_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false
  );
}

/**
 * Highlighting and notes for a single-document reader (PDF, web article,
 * DOCX) — everything the EPUB reader has, wired once: the shared selection
 * engine on the document's surface, the selection menu (Highlight / Note /
 * Copy / Delete), the signed-out and couldn't-save prompts, the notes panel,
 * and the notes feed with its FAB. The reader supplies only its surface (the
 * geometry of its text), where its blocks sit (`locate`) and how to reach one
 * (`jumpToBlock`), and draws its own highlights from `annotations.getForPassage`.
 *
 * Returns the annotations state (for drawing highlights), `onMarkClick` (for
 * those highlights — it also closes the feed, so the two panels never share
 * the slot) and `chrome`, which the reader renders once anywhere in its tree —
 * the menu, panels and FAB are fixed overlays and the selection draws itself
 * into `scrollEl`.
 */
export function useDocumentAnnotations({
  materialId,
  surface,
  scrollEl,
  layoutKey,
  getPassageText,
  locate,
  jumpToBlock,
  activeBlock,
}: {
  materialId: string;
  surface: SelectionSurface | null;
  scrollEl: HTMLElement | null;
  /** See useTextSelection's own — anything that moves the text without resizing
   * the scroll container. */
  layoutKey?: unknown;
  /** A block's full text (for quotes on ranges that don't carry their own). */
  getPassageText: (block: string) => string;
  /** Where each block sits, for the notes feed — see FeedLocator. Memoized. */
  locate: FeedLocator;
  /** Brings a block into view — a feed entry's "jump to". */
  jumpToBlock: (block: string) => void;
  /** The block the reader is on, so the feed opens scrolled to its run. */
  activeBlock?: string;
}) {
  const theme = useReaderStore((s) => s.theme);
  const isMobile = useNarrowViewport();
  const annotations = useTextAnnotations(materialId);
  const {
    selection,
    notesPanel,
    overlay,
    dismissOverlay,
    onTextSelect,
    dismissSelection,
    highlightSelection,
    noteFromSelection,
    hasExistingAnnotation,
    deleteSelection,
    closeNotesPanel,
    onNoteMarkerClick,
  } = annotations;

  const feed = useBookAnnotationFeed({ materialId, locate });
  const shareToRoom = useShareToRoom(materialId);
  const scrollChrome = useScrollChrome(scrollEl);
  const { close: closeFeed } = feed;
  const onMarkClick = useCallback(
    (block: string, annotationId: string) => {
      closeFeed();
      onNoteMarkerClick(block, annotationId);
    },
    [closeFeed, onNoteMarkerClick]
  );
  const jumpToEntry = useCallback((entry: FeedEntry) => jumpToBlock(entry.passageId), [jumpToBlock]);

  const selectionOverlay = useTextSelection({
    root: scrollEl,
    scrollEl,
    surface,
    active: Boolean(selection),
    onSelect: onTextSelect,
    layoutKey,
  });

  const [copied, setCopied] = useState(false);
  const copySelection = () => {
    if (!selection) return;
    void navigator.clipboard.writeText(quoteForRanges(selection.ranges, getPassageText)).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        dismissSelection();
      }, 800);
    });
  };

  const activeSectionId = activeBlock ? locate(activeBlock)?.sectionId : undefined;
  const iconSize = isMobile ? 18 : 14;
  const chrome: ReactNode = (
    <>
      {selectionOverlay}
      {selection && (
        <SelectionMenu
          anchor={selection.anchor}
          isMobile={isMobile}
          bottomOffsetPx={0}
          theme={theme}
          items={
            [
              { key: "highlight", icon: <Highlighter size={iconSize} />, label: "Highlight", onClick: highlightSelection },
              { key: "note", icon: <MessageCircle size={iconSize} />, label: "Note", onClick: noteFromSelection },
              { key: "copy", icon: <Copy size={iconSize} />, label: copied ? "Copied ✓" : "Copy", onClick: copySelection },
              ...(shareToRoom
                ? [
                    {
                      key: "room",
                      icon: <MessageSquareQuote size={iconSize} />,
                      label: "Share to room",
                      onClick: () => {
                        shareToRoom({
                          ranges: selection.ranges,
                          quote: quoteForRanges(selection.ranges, getPassageText),
                          label: locate(selection.ranges[0].passageId)?.label ?? "",
                        });
                        closeNotesPanel();
                        feed.openChat();
                        dismissSelection();
                      },
                    },
                  ]
                : []),
              ...(hasExistingAnnotation
                ? [{ key: "delete", icon: <Trash2 size={iconSize} />, label: "Delete", onClick: deleteSelection, danger: true }]
                : []),
            ] as Item[]
          }
          onDismiss={dismissSelection}
        />
      )}
      {overlay && (
        <SelectionMenu
          anchor={overlay.anchor}
          isMobile={isMobile}
          bottomOffsetPx={0}
          theme={theme}
          items={[]}
          override={
            overlay.kind === "auth" ? (
              <MembersOnlyPrompt action="highlight" onClose={dismissOverlay} />
            ) : (
              <div className="rounded-sm border border-[var(--reader-border)] bg-[var(--reader-surface)] p-3.5">
                <p className="m-0 text-[13px] font-medium leading-relaxed text-[var(--reader-text-muted)]">
                  Couldn&rsquo;t save — check your connection and try again.
                </p>
              </div>
            )
          }
          onDismiss={dismissOverlay}
        />
      )}
      {/* The same notes panel and feed as the EPUB reader: over the right edge
          on desktop, a bottom sheet on phones. Opening one closes the other. */}
      {(notesPanel || feed.open) && (
        <div className="fixed inset-0 z-[70] flex justify-end overflow-hidden pointer-events-none">
          <div className="h-full w-full shell:w-95">
            {notesPanel ? (
              <NotesSidebar
                key={notesPanel.annotationId ?? JSON.stringify(notesPanel.ranges)}
                materialId={materialId}
                passageId={notesPanel.passageId}
                getPassageText={getPassageText}
                annotationId={notesPanel.annotationId}
                pendingRanges={notesPanel.ranges}
                editingNoteId={notesPanel.editingNoteId}
                targetThreadId={notesPanel.targetThreadId}
                panelType={isMobile ? "sheet" : "side"}
                onClose={closeNotesPanel}
                onShare={() => {}}
              />
            ) : (
              <BookAnnotationFeedPanel
                materialId={materialId}
                items={feed.items}
                notes={feed.notes}
                filter={feed.filter}
                onFilterChange={feed.setFilter}
                activeSectionId={activeSectionId}
                onJump={jumpToEntry}
                getPassageText={getPassageText}
                panelType={isMobile ? "sheet" : "side"}
                onClose={closeFeed}
                focusedAuthor={feed.focusedAuthor}
                onClearAuthor={feed.clearAuthor}
              />
            )}
          </div>
        </div>
      )}
      {/* The same rail as the EPUB reader, on the same lifecycle: it hides
          while the notes panel or feed is up or text is selected, hides on
          scroll-down unless the reader is at the end, and folds once the
          reader scrolls on. */}
      <NotesFeedFab
        materialId={materialId}
        feed={feed}
        activeSectionId={activeSectionId}
        closeNotesPanel={closeNotesPanel}
        visible={!notesPanel && !feed.open && !selection && (!scrollChrome.hidden || scrollChrome.atBottom)}
        scrolledAway={scrollChrome.hidden && !scrollChrome.atBottom}
      />
    </>
  );

  return { annotations, onMarkClick, chrome };
}

/** How one annotation shows on the page — the same rules as the EPUB reader's
 * inline marks (PassageContent): the reader's own highlight or own note washes
 * the text; someone else's public note shows only the note glyph; a pending
 * selection (the notes panel open on a new thread) shows the wash but isn't
 * clickable. */
export function markStyle(a: Annotation, readerId: string | null) {
  const isPending = a.id === PENDING_ANNOTATION_ID;
  const hasOwnNote = readerId !== null && a.notes.some((n) => n.author.readerId === readerId);
  return {
    wash: isPending || a.highlighted || hasOwnNote,
    clickable: !isPending && (a.highlighted || a.notes.length > 0),
    noteCount: a.notes.length,
  };
}

/** The note glyph that follows a noted passage — outline speech bubble, with a
 * count when there's more than one entry (same as the EPUB reader's). */
export function NoteGlyph({ count, onClick, style }: { count: number; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      aria-label={`${count} note${count === 1 ? "" : "s"}`}
      onClick={onClick}
      className="pointer-events-auto absolute flex cursor-pointer items-baseline border-none bg-transparent p-0 text-[var(--reader-text-muted)]"
      style={style}
    >
      <MessageCircle size={12} strokeWidth={2.5} />
      {count > 1 && <span className="ml-px text-[9px] font-bold leading-none">{count}</span>}
    </button>
  );
}

type Box = { top: number; left: number; width: number; height: number };

/**
 * Draws highlights under DOM text (web articles, DOCX) — rects from the
 * surface, in the scroll container's content coordinates so they scroll with
 * the text, re-measured whenever the text reflows (resize, font size,
 * `layoutKey`). EPUB paints its marks inline instead, and PDF on each page.
 *
 * The wash sits *behind* the text (the scroll container must be its own
 * stacking context — `isolation: isolate` — so "behind" stops at its
 * background), exactly like the EPUB reader's, so it reads the same in every
 * theme. Being behind the text it can't take clicks, so a click on the text is
 * hit-tested against the measured marks instead; the note glyphs sit on top.
 */
export function DomHighlights({
  surface,
  scrollEl,
  annotations,
  onMarkClick,
  layoutKey,
}: {
  surface: SelectionSurface | null;
  scrollEl: HTMLElement | null;
  annotations: Annotation[];
  onMarkClick: (block: string, annotationId: string) => void;
  layoutKey?: unknown;
}) {
  const readerId = useSessionStore((s) => s.readerId);
  const [marks, setMarks] = useState<{ a: Annotation; boxes: Box[] }[]>([]);

  const measure = useCallback(() => {
    if (!surface || !scrollEl) return setMarks([]);
    const origin = scrollEl.getBoundingClientRect();
    setMarks(
      annotations.map((a) => {
        const first = a.ranges[0];
        const last = a.ranges[a.ranges.length - 1];
        const rects = first
          ? surface.rectsFor({ block: first.passageId, offset: first.start }, { block: last.passageId, offset: last.end })
          : [];
        return {
          a,
          boxes: rects.map((r) => ({
            top: r.top - origin.top + scrollEl.scrollTop,
            left: r.left - origin.left + scrollEl.scrollLeft,
            width: r.width,
            height: r.height,
          })),
        };
      })
    );
  }, [surface, scrollEl, annotations]);

  // Measured after layout (the text has to be in place to be measured), then
  // again whenever it reflows.
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [measure, layoutKey]);
  useEffect(() => {
    if (!scrollEl) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(scrollEl);
    if (scrollEl.firstElementChild) observer.observe(scrollEl.firstElementChild);
    return () => observer.disconnect();
  }, [scrollEl, measure]);

  // A plain click on marked text opens its thread. (The selection engine
  // swallows the click that ends a selecting gesture, so finishing a selection
  // on a mark never lands here.)
  useEffect(() => {
    if (!scrollEl) return;
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("a, button, input, textarea, select")) return;
      const origin = scrollEl.getBoundingClientRect();
      const x = e.clientX - origin.left + scrollEl.scrollLeft;
      const y = e.clientY - origin.top + scrollEl.scrollTop;
      const hit = marks.find(
        ({ a, boxes }) =>
          markStyle(a, readerId).clickable &&
          boxes.some((b) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height)
      );
      if (hit) onMarkClick(hit.a.ranges[0]?.passageId ?? "", hit.a.id);
    };
    scrollEl.addEventListener("click", onClick);
    return () => scrollEl.removeEventListener("click", onClick);
  }, [scrollEl, marks, readerId, onMarkClick]);

  if (!scrollEl) return null;
  return createPortal(
    <>
      <div aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-[-1]" style={{ width: 0, height: 0 }}>
        {marks.flatMap(({ a, boxes }) =>
          markStyle(a, readerId).wash
            ? boxes.map((b, i) => (
                <div key={`${a.id}:${i}`} className="absolute rounded-[2px]" style={{ ...b, background: "var(--reader-highlight)" }} />
              ))
            : []
        )}
      </div>
      <div className="pointer-events-none absolute left-0 top-0 z-[4]" style={{ width: 0, height: 0 }}>
        {marks.map(({ a, boxes }) => {
          const { noteCount } = markStyle(a, readerId);
          const last = boxes[boxes.length - 1];
          return noteCount > 0 && last ? (
            <NoteGlyph
              key={a.id}
              count={noteCount}
              onClick={() => onMarkClick(a.ranges[0]?.passageId ?? "", a.id)}
              style={{ top: last.top + last.height / 2 - 7, left: last.left + last.width + 4 }}
            />
          ) : null;
        })}
      </div>
    </>,
    scrollEl
  );
}
