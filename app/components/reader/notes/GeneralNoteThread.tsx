"use client";

import { repliesFor } from "@/lib/reader/noteThread";
import { useThreadInteraction } from "@/lib/reader/useThreadInteraction";
import type { Note } from "@/lib/api/types";
import NoteThreadCard from "./NoteThreadCard";

/** One book-level note in the "General discussion" section of the book-wide
 * feed (FeedPanel) — a note with no `ranges`, so unlike
 * FeedHighlightThread there's no quote, no "jump to passage" (there's no
 * passage to jump to), and no shared per-highlight root composer: every
 * general note is its own independent card, same "one root note + its own
 * flat reply thread, full stop" shape NoteCard already renders for the
 * home feed/book-details community tab — not a shared thread
 * several general notes pile into the way same-ranges annotated notes do.
 *
 * `allNotes` is this material's *entire* flat note list (from
 * useAnnotations), not just this thread's own — `repliesFor` narrows it to
 * this one root's replies, but `ranges: []` still has to be passed through
 * to useThreadInteraction as-is so a reply posted from here correctly
 * inherits the same empty anchor (see the API route's rangesEqual check). */
export default function GeneralNoteThread({
  materialId,
  note,
  allNotes,
  initialShowAll,
}: {
  materialId: string;
  note: Note;
  allNotes: Note[];
  initialShowAll?: boolean;
}) {
  const { ui, actions, expandedIds, toggleExpanded } = useThreadInteraction({
    materialId,
    ranges: note.ranges,
    allNotes: [note, ...repliesFor(allNotes, note.id)],
  });

  return (
    <NoteThreadCard
      note={note}
      replies={repliesFor(allNotes, note.id)}
      expanded={expandedIds.has(note.id)}
      initialShowAll={initialShowAll}
      onToggleExpand={() => toggleExpanded(note.id)}
      ui={ui}
      actions={actions}
    />
  );
}
