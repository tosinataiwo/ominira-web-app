"use client";

import { quoteForRanges } from "@/lib/reader/annotationSelection";
import { topLevelNotes, repliesFor, sortNotes } from "@/lib/reader/noteThread";
import { useThreadInteraction } from "@/lib/reader/useThreadInteraction";
import type { FeedEntry } from "@/lib/reader/annotationFeed";
import HighlightCard from "./HighlightCard";
import NoteThreadCard from "./NoteThreadCard";

/** One highlight's full block in the book-wide feed — a truncated quote
 * (HighlightCard's own universal "See more") that's itself the "show in passage"
 * click target (`onJump`), followed by the exact same interactive thread
 * the standalone note panel renders for this highlight — full
 * reply/edit/delete/react, not a read-only summary, via the same
 * useThreadInteraction hook that panel uses. Which section this excerpt
 * belongs to is the enclosing feed's own label's job (see
 * FeedPanel), not repeated per card. Every root note's own
 * replies start expanded, the one standard default useThreadInteraction
 * applies everywhere a thread is surfaced. */
export default function FeedHighlightThread({
  materialId,
  entry,
  getPassageText,
  onJump,
  targetThreadId,
}: {
  materialId: string;
  entry: FeedEntry;
  getPassageText: (passageId: string) => string;
  onJump: (entry: FeedEntry) => void;
  targetThreadId?: string;
}) {
  const { annotation } = entry;
  const excerpt = quoteForRanges(annotation.ranges, getPassageText);
  const { ui, actions, expandedIds, toggleExpanded } = useThreadInteraction({
    materialId,
    ranges: annotation.ranges,
    allNotes: annotation.notes,
    // A reply added from here can be added to a highlight the reader isn't
    // actually looking at right now (they're browsing the feed, not
    // necessarily at this passage) — same "always land where the note
    // actually is" reasoning.
    onNoteAdded: () => onJump(entry),
  });
  const roots = sortNotes(topLevelNotes(annotation.notes), "chronological");

  return (
    <div className="flex flex-col gap-3 border-l-2 border-[var(--reader-border)] pl-4">
      <HighlightCard text={excerpt} onJump={() => onJump(entry)} />

      {roots.length > 0 && (
        <div className="flex flex-col gap-4">
          {roots.map((note) => (
            <NoteThreadCard
              key={note.id}
              note={note}
              replies={repliesFor(annotation.notes, note.id)}
              expanded={expandedIds.has(note.id)}
              initialShowAll={targetThreadId === note.id}
              onToggleExpand={() => toggleExpanded(note.id)}
              ui={ui}
              actions={actions}
            />
          ))}
        </div>
      )}

      {ui.actionError && <p className="m-0 text-[11px] text-[var(--reader-text-muted)]">{ui.actionError}</p>}
    </div>
  );
}
