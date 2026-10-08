"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useReadingPositionStore, type PositionInput } from "@/stores/reading-position-store";
import { useIsAuthenticated } from "@/lib/auth/useIsAuthenticated";
import { useCreateNote } from "@/lib/community/useNoteMutations";
import { useMaterialNotes } from "@/lib/materials/useMaterialNotes";
import { repliesFor, topLevelNotes } from "@/lib/reader/noteThread";
import NoteComposer from "./notes/NoteComposer";
import NoteCard from "./notes/NoteCard";
import Tooltip from "./Tooltip";

/**
 * The end of a document, for every format — one shared component so "you've
 * finished this" is the same moment whether it closes an EPUB, a PDF, a DOCX or
 * a web article.
 *
 * It exists because completion is not derivable from progress: `locatorPercent`
 * divides an index by a count, so the final passage/page/block always lands
 * just short of 100 (see lib/reader/locator.ts's positionPercent). Rather than
 * fake a threshold, the reader says so here — explicitly, in every mode,
 * including listening. Reaching the end is not the same claim as having read
 * it: readers jump to the end, skim back matter, and land on appendices.
 *
 * Finishing is a toggle rather than a one-way action — un-finishing restores the
 * real tracked percentage rather than leaving a fabricated 100 behind — and it's
 * presented as a checkbox rather than a call-to-action button: the reader is
 * recording something they already did, not being asked to do something.
 *
 * It renders as its own screen (a tall, centred section) rather than a block
 * under the last paragraph, so that in every format the end of a document reads
 * as a place the reader arrives at.
 *
 * The reflection composer is the same `NoteComposer` the reader's notes panel
 * uses, saving a general (`ranges: []`) note against this material — so a
 * closing thought lands in the community feed exactly like any other book-level
 * note, with no separate posting path to keep in sync. Those same book-level
 * notes are then listed here, so the end of a document shows what the room made
 * of it, and a reflection written here appears immediately (useCreateNote's
 * optimistic write) instead of vanishing into a feed elsewhere. Signed-out readers get
 * NoteComposer's own membership prompt; the finish button is simply not offered,
 * since there's no reader row to record it against.
 */
export default function DocumentEndPanel({
  materialId,
  title,
  getCurrentPosition,
}: {
  materialId: string;
  title: string;
  /** Where the reader is *at the moment they tap*, for the case where finishing
   * is the very first thing ever recorded for this material (a short article
   * read in one screenful, with no committed position yet) — see setFinished.
   * A function, not a value: the honest answer is the one at click time, and
   * this panel re-renders for reasons unrelated to where the reader is. */
  getCurrentPosition: () => PositionInput | undefined;
}) {
  const isAuthenticated = useIsAuthenticated();
  const finishedAt = useReadingPositionStore((s) => s.positions[materialId]?.finishedAt ?? null);
  const setFinished = useReadingPositionStore((s) => s.setFinished);
  const createNote = useCreateNote(materialId);
  const [noteError, setNoteError] = useState<string | null>(null);

  // The material's book-level notes — the same `ranges: []` thread this panel
  // posts into, so a reflection appears here the instant it's written:
  // useCreateNote patches this very cache entry optimistically (see its own doc
  // comment), which is what makes the post feel like it landed rather than like
  // it went somewhere else to be looked at later.
  const { data: allNotes } = useMaterialNotes(materialId);
  const reflections = useMemo(
    () =>
      topLevelNotes(allNotes)
        .filter((note) => note.ranges.length === 0)
        // Oldest first, the same "read start to finish" convention the
        // book-wide feed's own General discussion run uses. The list sits
        // above the composer (see below), so this also puts a just-posted
        // reflection at the bottom, right above the composer it came from —
        // the same "newest closest to where you're about to type next"
        // order a chat thread reads in.
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [allNotes]
  );

  const finishedLabel = finishedAt
    ? `Finished ${new Date(finishedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
    : "Finished";

  return (
    // A screen of its own, not a footnote under the last paragraph: min-h-[80dvh]
    // plus a centred column means the end of a document arrives as somewhere the
    // reader has *got to*, and the bottom padding keeps the composer clear of
    // whatever chrome the format's own viewer floats over the content (a pager,
    // a chapter footer, the now-playing bar).
    <section className="mt-16 flex min-h-[80dvh] flex-col justify-center border-t border-[var(--reader-border)] pt-12 pb-28">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--reader-text-subtle)]">
        The end
      </div>
      <h2 className="font-serif type-3 text-balance mt-2 text-[var(--reader-text)]">
        {finishedAt ? `You finished ${title}` : `You've reached the end of ${title}`}
      </h2>

      {isAuthenticated && (
        <div className="mt-6">
          {/* A checkbox, not a call to action. One control that toggles both
              ways (so there's no separate "unfinish" affordance to find), quiet
              enough not to compete with the reflection prompt below it, and
              legible at a glance either way: an empty circle to tick, or a
              filled one with the date it was ticked. The check greys in on hover
              while unfinished, which is what makes the tap's outcome obvious
              before it's made. */}
          {/* The button's own label already says "Mark as finished" while
              unticked, so the tooltip only has real work to do once it's
              ticked and that label turns into a date — this is what says
              "tap to undo this" once the visible text no longer does. */}
          <Tooltip label={finishedAt ? "Tap to mark as unfinished" : "Tap to mark as finished"} side="top">
            <button
              type="button"
              onClick={() => setFinished(materialId, !finishedAt, getCurrentPosition())}
              aria-pressed={Boolean(finishedAt)}
              className={`group inline-flex cursor-pointer items-center gap-2.5 rounded-full border bg-transparent py-2 pl-2 pr-4 text-[13px] font-bold transition-colors ${
                finishedAt
                  ? "border-brand-500 text-brand-600"
                  : "border-[var(--reader-border)] text-[var(--reader-text-muted)] hover:border-[var(--reader-text-subtle)] hover:text-[var(--reader-text)]"
              }`}
            >
              <span
                className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border transition-colors ${
                  finishedAt
                    ? "border-brand-500 bg-brand-500 text-white"
                    : "border-[var(--reader-border)] text-transparent group-hover:border-[var(--reader-text-subtle)] group-hover:text-[var(--reader-text-subtle)]"
                }`}
              >
                <Check size={12} strokeWidth={3} />
              </span>
              {finishedLabel}
            </button>
          </Tooltip>
        </div>
      )}

      <div className="mt-8">
        {/* Above the composer, oldest to newest (see reflections' own sort
            comment) — this reads as the room's ongoing conversation you're
            about to add to, not a log that appears underneath what you just
            wrote. The exact same NoteCard (materialId/note/replies, no
            excerpt or bookContext — a general reflection has neither) every
            other flat list of notes in the app renders through — the home
            feed, the community-notes tab — rather than a second wrapper
            reinventing its own border-b/py-4 row treatment. */}
        {reflections.length > 0 && (
          <div className="mb-2">
            {reflections.map((note) => (
              <NoteCard key={note.id} materialId={materialId} note={note} replies={repliesFor(allNotes, note.id)} />
            ))}
          </div>
        )}

        <div className="mb-2 mt-10 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--reader-text-subtle)]">
          {finishedAt ? "Share a closing thought" : "Notes, ideas, reflections?"}
        </div>
        <NoteComposer
          initialText=""
          placeholder="Share a thought"
          showMemberPrompt
          action="note"
          draftKey={`finish-${materialId}`}
          onSave={(content, visibility) => {
            setNoteError(null);
            createNote.mutate(
              // No ranges: a closing reflection is about the material as a
              // whole, not a passage in it — the same general-note shape the
              // book-wide notes panel posts.
              { ranges: [], content, visibility },
              { onError: () => setNoteError("Couldn't save your note — check your connection and try again.") }
            );
          }}
        />
        {/* Same muted treatment FeedPanel gives its own composer
            error — reader chrome, not an alarm. */}
        {noteError && <p className="m-0 mt-2 text-[11px] text-[var(--reader-text-muted)]">{noteError}</p>}
      </div>
    </section>
  );
}
