import type { NarrationDocument } from "@/lib/audio/narrationDocument";
import { hasNarratableText, passageChunkTexts } from "@/lib/audio/narrationText";
import { buildSectionsById } from "@/lib/reader/sections";

/**
 * One narration target — almost always a whole passage: `chunkIndex` is a
 * passage-local offset into `passageChunkTexts(passage)`, the same "chunk"
 * dimension liveNarrationCache keys clips by, but that's now (see
 * narrationText.ts's own doc comment) a sentence-sized split only for the
 * rare passage long enough to need one at all — for every ordinary
 * passage there's exactly one chunk, index 0, and a NarrationTarget is
 * simply "this passage, in this section".
 */
export type NarrationTarget = { sectionId: string; passageId: string; chunkIndex: number };

/**
 * The book's entire run of narratable passages (chunks, in the rare
 * multi-chunk case), flattened into one sequence in spine order — section
 * boundaries and passage boundaries are just points inside this one array,
 * not separate cases. This is what lets `next`/`prev` cross a passage or
 * section boundary exactly the same way they cross a chunk boundary inside
 * one long passage: the caller (the narration state machine, lib/audio/
 * NarrationEngine's reconciler) never has to special-case "this was the
 * section's last passage" — it just asks this index for the next target
 * and gets one, or `undefined` at the true end of the book.
 *
 * Built once per (book, and implicitly its passages' text) — pure and
 * network-free, same as passageChunkTexts itself — so it's cheap to
 * recompute with a plain `useMemo` keyed on the book.
 */
export type BookNarrationIndex = {
  targets: NarrationTarget[];
  /** -1 if `target` isn't a real one in this book (stale reference after a
   * book swap, or a passage with nothing narratable). */
  indexOf(target: NarrationTarget): number;
  next(target: NarrationTarget): NarrationTarget | undefined;
  prev(target: NarrationTarget): NarrationTarget | undefined;
  /** The first target of a given section, if it has one — what a
   * chapter-skip/chapters-drawer jump lands on. */
  firstOf(sectionId: string): NarrationTarget | undefined;
};

export function buildNarrationIndex(book: NarrationDocument): BookNarrationIndex {
  const targets: NarrationTarget[] = [];
  const sectionStart = new Map<string, number>();
  // Sections can be nested under Part groupings (book.sections is the
  // top-level tree; a spine entry is very often one of a Part's children,
  // not a top-level section) — a shallow `book.sections.find` here used to
  // silently drop every such section from the index entirely, which is
  // what made chapter-skip (and the very first resume target, if the
  // book's first spine entry is itself nested) look broken. buildSectionsById
  // is the one shared, recursive lookup every other narration/reader code
  // path already resolves section ids through.
  const sectionsById = buildSectionsById(book.sections);

  for (const sectionId of book.spine) {
    const section = sectionsById.get(sectionId);
    if (!section) continue;
    let recordedStart = false;
    for (const passage of section.passages) {
      if (!hasNarratableText(passage)) continue;
      const chunkCount = passageChunkTexts(passage).length;
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
        if (!recordedStart) {
          sectionStart.set(sectionId, targets.length);
          recordedStart = true;
        }
        targets.push({ sectionId, passageId: passage.id, chunkIndex });
      }
    }
  }

  // passageId+chunkIndex is already unique across the whole book (ids are
  // book-wide, not just section-local), so a plain key lookup is enough —
  // no need to also carry sectionId in the key.
  const positionByKey = new Map<string, number>();
  targets.forEach((t, i) => positionByKey.set(`${t.passageId}#${t.chunkIndex}`, i));

  const indexOf = (target: NarrationTarget): number => positionByKey.get(`${target.passageId}#${target.chunkIndex}`) ?? -1;

  return {
    targets,
    indexOf,
    next: (target) => {
      const i = indexOf(target);
      return i < 0 ? undefined : targets[i + 1];
    },
    prev: (target) => {
      const i = indexOf(target);
      return i <= 0 ? undefined : targets[i - 1];
    },
    firstOf: (sectionId) => {
      const i = sectionStart.get(sectionId);
      return i === undefined ? undefined : targets[i];
    },
  };
}
