export type KaraokeWord = {
  passageId: string;
  /** Passage-wide word index (the `data-word-index` it lights), not the
   * position in its chunk's clip: a long passage's later chunks start past
   * the words of the chunks before them. */
  index: number;
  text: string;
  startMs: number;
  endMs: number;
};

/**
 * Which word (by index into `words`) is playing at `atMs` — a flat scan
 * back from the end, since narration only ever moves forward through a
 * handful of words at a time and this runs on every playhead tick.
 *
 * Deliberately flat, word-level only — no sentence/line grouping (see
 * PassageContent.tsx/Reader.tsx's own comments on why: concept 1b,
 * "Highlighter Wash," lights exactly one word at a time with nothing else
 * in the sentence dimmed or grouped around it).
 */
export function activeWordIndex(words: KaraokeWord[], atMs: number): number {
  for (let i = words.length - 1; i >= 0; i--) {
    if (atMs >= words[i].startMs) return i;
  }
  return 0;
}
