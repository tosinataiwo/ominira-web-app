"use client";

import { memo, type ReactElement, type ReactNode, useState } from "react";
import { Pause, Play } from "lucide-react";
import { ImagePassageBlock, MarkedText, PassageText, type NoteLookup } from "./PassageContent";
import type { BookDocument, Passage, Section, TableCell } from "@/lib/book/schema";
import type { Annotation } from "@/stores/library-store";

// How much larger than body text each heading level renders — h1 down to
// h6/unleveled, so a chapter's own subheadings stay visually distinct from
// its title instead of one uniform "heading" size for every <h1>-<h6>.
const HEADING_FONT_BUMP: Record<number, number> = { 1: 16, 2: 10, 3: 6, 4: 4, 5: 2, 6: 1 };
function headingFontBump(level: number | undefined): number {
  return level !== undefined ? HEADING_FONT_BUMP[level] ?? 1 : 8;
}

// The reading column's width (--reader-max-width) is tuned for text line length,
// not for a portrait cover image — full-width there reads as bloated on a
// wide pane. Front-matter cover images alone get capped below that; every
// other image in the book still renders at the full column width exactly
// as its own dimensions call for. This is just the *cap* — ImagePassageBlock
// itself resolves it against the actual rendered column width (which is
// already bounded by --reader-max-width through its own ancestor, and by the real
// viewport on any screen narrower than that) via a CSS `min()`, so a
// column or screen narrower than 340 shrinks the cover to fit rather
// than this constant overriding it. No JS-side `Math.min` against
// the column width needed here as a result — see ImagePassageBlock's comment.
const FRONT_COVER_MAX_WIDTH_PX = 340;

type BookContentProps = {
  book: BookDocument;
  activeIndex: number;
  registerSlide: (id: string) => (el: HTMLDivElement | null) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onAnyClick: () => void;
  contentPad: string;
  contentTopPad: number;
  contentBottomPad: number;
  orderedSections: Section[];
  notesIndexSectionId: string | null;
  notesIndexGroups: { heading: Passage; notes: BookDocument["notes"] }[] | null;
  getAnnotations: (passageId: string) => Annotation[];
  notesById: Map<string, NoteLookup>;
  onNoteClick: (note: NoteLookup, target: HTMLElement) => void;
  onInternalLinkClick: (sectionId: string, fragmentId?: string) => void;
  /** A plain click on any existing mark — highlight-only or noted alike —
   * opening its thread directly. */
  onNoteMarkerClick: (passageId: string, annotationId: string) => void;
  /** Passed straight through to PassageText — see its own doc comment. */
  justJumpedAnnotationId: string | null;
  /** Starts narration at a specific paragraph, including from normal read
   * mode. The active paragraph's control also toggles pause/play. */
  onPassagePlayback?: (sectionId: string, passageId: string) => void;
  currentPlayingPassageId?: string;
  /** Keeps stable word markers in the DOM for the karaoke underline; when
   * present (listen mode) each word is also an affordance to seek/jump
   * narration — critical on mobile where the per-paragraph play control is
   * hidden (see globals.css). */
  trackNarrationWords?: boolean;
  /** Rendered at the very bottom of the *last* spine section's content — the
   * end of the book, where DocumentEndPanel lives (Reader.tsx builds it). A
   * node rather than a render prop, and memoized by the caller, so it doesn't
   * defeat this component's own memo() on every parent render. */
  endSlot?: ReactNode;
  /** Whether the active paragraph control represents pause rather than
   * play. This only flips on play/pause, nowhere near the per-word timing
   * frequency that would defeat this component's memoization. */
  isNarrationPlaying?: boolean;
};

type TableShape = NonNullable<Passage["table"]>;
type TableRow = TableShape["rows"][number];
type DefinitionItem = NonNullable<Passage["definitions"]>[number];

/**
 * The book itself — only the *active* section is ever mounted (not a
 * horizontal carousel of every section side by side): swipe/arrow/edge-
 * click/keyboard all resolve to a plain activeIndex change, and moving to a
 * new section is a full remount (`key={section.id}` below) with a quick
 * `reader-fade-in` animation, not a translated/sliding DOM. Two earlier
 * attempts at a real sliding transition (hand-rolled `translateX`, then
 * Embla Carousel) both ran into rendering bugs from the same root cause: a
 * horizontal carousel whose slides are also independently tall,
 * vertically-scrolling regions isn't a shape either approach handles well.
 * Mounting one section at a time sidesteps that entirely, and is simpler
 * besides — no `content-visibility` virtualization needed either, since
 * there's nothing else mounted to virtualize.
 */
const BookContent = memo(function BookContent({
  book,
  activeIndex,
  registerSlide,
  onPointerDown,
  onPointerUp,
  onAnyClick,
  contentPad,
  contentTopPad,
  contentBottomPad,
  orderedSections,
  notesIndexSectionId,
  notesIndexGroups,
  getAnnotations,
  notesById,
  onNoteClick,
  onInternalLinkClick,
  onNoteMarkerClick,
  justJumpedAnnotationId,
  onPassagePlayback,
  currentPlayingPassageId,
  trackNarrationWords,
  isNarrationPlaying,
  endSlot,
}: BookContentProps) {
  const firstSectionId = orderedSections[0]?.id;
  const lastSectionId = orderedSections[orderedSections.length - 1]?.id;
  const section = orderedSections[activeIndex];
  const [revealedPassageId, setRevealedPassageId] = useState<string | null>(null);

  if (!section) {
    return <div className="flex-1 min-h-0 relative overflow-hidden" />;
  }

  const isPartDivider = section.children.length > 0;
  const isNotesIndex = section.id === notesIndexSectionId && notesIndexGroups;
  const passageNodes: ReactElement[] = [];

  const renderPassage = (raw: Passage, asListItem = false): ReactElement => {
    const annotations = getAnnotations(raw.id);
    const isHeading = raw.type === "heading";
    const isBlockquote = raw.type === "blockquote";
    const isCode = raw.type === "code";
    const isHorizontalRule = raw.type === "horizontalRule";
    const isImage = raw.type === "image";
    const isTable = raw.type === "table";
    const isFrontCoverImage = isImage && section.kind === "front";
    const headingBump = isPartDivider ? 14 : headingFontBump(raw.level);
    const textAlign = raw.align ?? (isHeading && isPartDivider ? "center" : isFrontCoverImage ? "center" : "left");
    const marginTop = isHeading ? (isPartDivider ? 40 : 24) : isCode ? 20 : isBlockquote ? 18 : isTable ? 24 : 0;
    const marginBottom = "var(--reader-paragraph-spacing)";
    const canPlayPassage = Boolean(onPassagePlayback && raw.text.trim() && !isHeading && !isImage && !isTable);
    const isCurrentPassage = currentPlayingPassageId === raw.id;
    const narrationClass = canPlayPassage
      ? ` om-narration-passage${isCurrentPassage ? " om-narrating-passage" : ""}${revealedPassageId === raw.id ? " om-passage-control-revealed" : ""}`
      : "";
    const revealOnTouch = canPlayPassage ? () => setRevealedPassageId(raw.id) : undefined;
    // On mobile the per-paragraph play button is hidden (globals.css), so the
    // karaoke words themselves become the seek affordance when listening.
    // Delegated at the passage container: any descendant [data-word-index]
    // click seeks to this passage. Guards against hijacking a fresh
    // drag-selection and against note/highlight/annotation clicks that
    // already stopPropagation at the inner span.
    const handleWordClick = (e: React.MouseEvent) => {
      if (!trackNarrationWords || !onPassagePlayback || !canPlayPassage) return;
      const target = e.target as HTMLElement;
      const wordEl = target.closest("[data-word-index]");
      if (!wordEl) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      e.stopPropagation();
      onPassagePlayback(section.id, raw.id);
    };
    const narrationControl = canPlayPassage ? (
      <button
        type="button"
        className="om-passage-play no-callout hidden shell:inline-flex"
        // Inline values deliberately win over generic button/icon styles:
        // this control is neutral reader chrome, never a brand-accent CTA.
        style={{ color: "var(--reader-text)", borderColor: "var(--reader-border)" }}
        aria-label={isCurrentPassage && isNarrationPlaying ? "Pause narration" : "Play from this paragraph"}
        title={isCurrentPassage && isNarrationPlaying ? "Pause narration" : "Play from this paragraph"}
        onClick={(event) => {
          event.stopPropagation();
          onPassagePlayback!(section.id, raw.id);
        }}
      >
        {isCurrentPassage && isNarrationPlaying ? <Pause aria-hidden="true" size={14} strokeWidth={1.6} fill="currentColor" /> : <Play aria-hidden="true" size={14} strokeWidth={1.6} fill="currentColor" />}
      </button>
    ) : null;

    if (isImage) {
      // ImagePassageBlock's own <figure> is shrink-wrapped specifically so
      // this text-align has something to position — a block-level figure
      // would already fill the line regardless of alignment.
      return (
        <div
          key={raw.id}
          data-passage-id={raw.id}
          data-passage-type={raw.type}
          style={{ marginBottom, textAlign }}
        >
          <ImagePassageBlock
            passage={raw}
            maxWidthPx={isFrontCoverImage ? FRONT_COVER_MAX_WIDTH_PX : undefined}
          />
        </div>
      );
    }

    if (isHorizontalRule) {
      return (
        <div key={raw.id} data-passage-id={raw.id} data-passage-type={raw.type} style={{ marginTop, marginBottom }}>
          <hr className="border-0 border-t border-[var(--reader-border)]" />
        </div>
      );
    }

    const passageText = (
      <PassageText
        passage={raw}
        notesById={notesById}
        onNoteClick={onNoteClick}
        onInternalLinkClick={onInternalLinkClick}
        annotations={annotations}
        onNoteMarkerClick={(annotationId) => onNoteMarkerClick(raw.id, annotationId)}
        trackNarrationWords={trackNarrationWords}
        justJumpedAnnotationId={justJumpedAnnotationId}
      />
    );

    const sharedStyle: React.CSSProperties = {
      fontFamily: "var(--reader-font-family)",
      fontWeight: isHeading ? 700 : 400,
      fontSize: isHeading ? `calc(var(--reader-font-size) + ${headingBump}px)` : "var(--reader-font-size)",
      lineHeight: isHeading ? 1.3 : "var(--reader-line-height)",
      color: "var(--reader-text)",
      textAlign,
      ...(isHeading && isPartDivider
        ? { textTransform: "uppercase", letterSpacing: "0.08em" }
        : {}),
    };

    if (isCode) {
      return (
        <div
          key={raw.id}
          data-passage-id={raw.id}
          data-passage-type={raw.type}
          style={{ marginTop, marginBottom }}
        >
          <pre
            className="m-0 overflow-x-auto rounded-xs border border-[var(--reader-border)] bg-[var(--reader-surface-hover)] px-3 py-2.5"
            style={sharedStyle}
          >
            <code className="font-mono whitespace-pre-wrap">
              {passageText}
            </code>
          </pre>
        </div>
      );
    }

    if (raw.type === "table" && raw.table) {
      const table = raw.table as TableShape;
      const renderCell = (
        cell: TableCell,
        index: number,
        head = false
      ) => {
        const cellStyle = {
          textAlign: cell.align ?? "left",
          fontFamily: "var(--reader-font-family)",
          color: "var(--reader-text)",
        };
        // schemaVersion >= 4: cell.marks carries inline formatting/note refs
        // over cell.text, same vocabulary as passage marks — gated on the
        // field's own presence (never on schemaVersion itself), so this
        // renders identically whether the book is v3 (marks always absent,
        // MarkedText falls back to plain text) or v4.
        const cellContent = (
          <MarkedText
            text={cell.text}
            marks={cell.marks}
            notesById={notesById}
            onNoteClick={onNoteClick}
            onInternalLinkClick={onInternalLinkClick}
          />
        );
        if (head) {
          return (
            <th
              key={index}
              rowSpan={cell.rowspan}
              colSpan={cell.colspan}
              scope="col"
              className="border border-[var(--reader-border)] px-3 py-2 align-top font-semibold"
              style={cellStyle}
            >
              {cellContent}
            </th>
          );
        }
        return (
          <td
            key={index}
            rowSpan={cell.rowspan}
            colSpan={cell.colspan}
            className="border border-[var(--reader-border)] px-3 py-2 align-top"
            style={cellStyle}
          >
            {cellContent}
          </td>
        );
      };
      return (
        <figure key={raw.id} data-passage-id={raw.id} data-passage-type={raw.type} style={{ marginTop, marginBottom }}>
          <div className="overflow-x-auto rounded-xs border border-[var(--reader-border)]">
            <table className="w-full border-collapse text-sm" style={{ color: "var(--reader-text)" }}>
              {table.caption && (
                <caption className="caption-bottom px-3 py-2 text-left text-xs text-[var(--reader-text-muted)]">
                  {table.caption}
                </caption>
              )}
              {table.header && table.header.length > 0 && (
                <thead className="bg-[var(--reader-surface-hover)]">
                  {table.header.map((row: TableRow, rowIndex: number) => (
                    <tr key={rowIndex}>{row.map((cell: TableCell, index: number) => renderCell(cell, index, true))}</tr>
                  ))}
                </thead>
              )}
              <tbody>
                {table.rows.map((row: TableRow, rowIndex: number) => (
                  <tr key={rowIndex}>{row.map((cell: TableCell, index: number) => renderCell(cell, index, false))}</tr>
                ))}
              </tbody>
              {table.footer && table.footer.length > 0 && (
                <tfoot className="bg-[var(--reader-surface-hover)]">
                  {table.footer.map((row: TableRow, rowIndex: number) => (
                    <tr key={rowIndex}>{row.map((cell: TableCell, index: number) => renderCell(cell, index, false))}</tr>
                  ))}
                </tfoot>
              )}
            </table>
          </div>
        </figure>
      );
    }

    if (raw.type === "definitionList" && raw.definitions) {
      const definitions = raw.definitions as DefinitionItem[];
      return (
        <div key={raw.id} data-passage-id={raw.id} data-passage-type={raw.type} style={{ marginTop, marginBottom }}>
          <dl className="m-0 grid gap-3 rounded-xs border border-[var(--reader-border)] bg-[var(--reader-surface)] p-4">
            {definitions.map((item: DefinitionItem, index: number) => (
              <div key={`${raw.id}-${index}`} className="grid gap-1">
                <dt className="font-semibold text-[var(--reader-text)]">{item.term}</dt>
                {item.definitions.map((definition: string, defIndex: number) => (
                  <dd key={defIndex} className="m-0 pl-4 text-sm leading-relaxed text-[var(--reader-text)]">
                    {definition}
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        </div>
      );
    }

    if (isBlockquote) {
      return (
        <div
          key={raw.id}
          data-passage-id={raw.id}
          data-passage-type={raw.type}
          style={{ marginTop, marginBottom }}
        >
          <blockquote
            className={`m-0 border-l-2 border-[var(--reader-border)] pl-4${narrationClass}`}
            style={sharedStyle}
            onTouchStart={revealOnTouch}
            onClick={handleWordClick}
          >
            {narrationControl}{passageText}
          </blockquote>
        </div>
      );
    }

    if (asListItem || raw.type === "listItem") {
      const listLevel = raw.listLevel ?? 1;
      return (
        <li
          key={raw.id}
          data-passage-id={raw.id}
          data-passage-type={raw.type}
          className={`m-0${narrationClass}`}
          onTouchStart={revealOnTouch}
          onClick={handleWordClick}
          style={{
            ...sharedStyle,
            marginTop,
            marginBottom,
            marginLeft: `${Math.max(0, listLevel - 1) * 20}px`,
            listStylePosition: "outside",
          }}
        >
          {narrationControl}{passageText}
        </li>
      );
    }

    return (
      <p
        key={raw.id}
        data-passage-id={raw.id}
        data-passage-type={raw.type}
        className={`m-0 font-serif rounded-xs no-callout${narrationClass}`}
        onTouchStart={revealOnTouch}
        onClick={handleWordClick}
        // sharedStyle deliberately carries no margin — every other passage
        // type (code, blockquote, table, list item, ...) applies
        // marginTop/marginBottom itself on whatever element it renders.
        // This fallback (plain paragraphs and headings — the two most
        // common passage types) was the one branch that returned <p>
        // directly with just sharedStyle and never added its own, so
        // consecutive paragraphs rendered with zero space between them.
        style={{ ...sharedStyle, marginTop, marginBottom }}
      >
        {narrationControl}{passageText}
      </p>
    );
  };

  for (let i = 0; i < section.passages.length; ) {
    const raw = section.passages[i];
    if (raw.type === "listItem") {
      const listStyle = raw.listStyle ?? "unordered";
      const listLevel = raw.listLevel ?? 1;
      const items: Passage[] = [];
      let j = i;
      while (j < section.passages.length) {
        const current = section.passages[j];
        if (current.type !== "listItem") break;
        if ((current.listStyle ?? "unordered") !== listStyle) break;
        if ((current.listLevel ?? 1) !== listLevel) break;
        items.push(current);
        j++;
      }
      if (listStyle === "ordered") {
        passageNodes.push(
          <ol
            key={`${raw.id}-list`}
            data-passage-type="list"
            className="m-0 py-0"
            style={{
              paddingLeft: 0,
              marginTop: 0,
              marginBottom: "var(--reader-paragraph-spacing)",
            }}
            start={items[0].listStart}
          >
            {items.map((item) => renderPassage(item, true))}
          </ol>
        );
      } else {
        passageNodes.push(
          <ul
            key={`${raw.id}-list`}
            data-passage-type="list"
            className="m-0 py-0"
            style={{
              paddingLeft: 0,
              marginTop: 0,
              marginBottom: "var(--reader-paragraph-spacing)",
            }}
          >
            {items.map((item) => renderPassage(item, true))}
          </ul>
        );
      }
      i = j;
      continue;
    }

    passageNodes.push(renderPassage(raw));
    i++;
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className="flex-1 min-h-0 relative overflow-hidden"
    >
      <div
        key={section.id}
        ref={registerSlide(section.id)}
        data-section-id={section.id}
        onClick={onAnyClick}
        // No native selection anywhere in the book: text selection is the
        // shared engine's (lib/annotations/useTextSelection, bound to this
        // slide by Reader.tsx) — on iOS, keeping native selection off is the
        // only way to keep the system's Copy/Look Up menu from appearing
        // alongside our own. no-callout keeps the long-press callout away too.
        // isolate: the selection's wash sits behind the text, stopping at
        // this slide's own background.
        className={`reader-fade-in om-scroll h-full overflow-y-auto relative isolate select-none no-callout${
          isNarrationPlaying ? " om-listen-active" : ""
        }`}
        style={{ background: "var(--reader-bg)" }}
      >
        <div
          className={`mx-auto box-border ${contentPad}`}
          style={{ maxWidth: "var(--reader-max-width)", paddingTop: contentTopPad, paddingBottom: contentBottomPad }}
        >
          {section.id === firstSectionId && (
            // Inline byline — book title/author live in the scrolling
            // content itself (Matter-style: the header stays minimal),
            // shown once at the very start of the book.
            <div className="mb-10">
              <div className="text-[11px] font-semibold tracking-wide uppercase text-[var(--reader-text-muted)]">
                {book.metadata.author}
              </div>
              <div className="text-2xl font-semibold font-serif text-[var(--reader-text)] mt-1">
                {book.metadata.title}
              </div>
            </div>
          )}

          {isNotesIndex
            ? notesIndexGroups!.map(({ heading, notes }) => (
                <div key={heading.id} data-passage-id={heading.id} className="mb-8">
                  <h3
                    className="font-serif font-semibold text-lg m-0 mb-3"
                    style={{ color: "var(--reader-text)" }}
                  >
                    {heading.text}
                  </h3>
                  {notes.length === 0 ? (
                    <p className="text-sm text-[var(--reader-text-muted)] m-0">
                      {/* No notes */}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {notes.map((n) => (
                        <p
                          key={n.id}
                          className="m-0 font-serif text-sm leading-relaxed"
                          style={{ color: "var(--reader-text)" }}
                        >
                          {n.text}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))
            : passageNodes}

          {section.id === lastSectionId && endSlot}
        </div>
      </div>

      {/* Hints that there's more below before hitting the docked
          ChapterNavFooter (Reader.tsx) — purely visual, pointer-events-none
          so it never intercepts scroll/selection. */}
      {/* <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
        style={{ background: "linear-gradient(to bottom, transparent, var(--reader-bg))" }}
      /> */}
    </div>
  );
});

export default BookContent;
