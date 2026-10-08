import type { Passage } from "@/lib/book/schema";
import { splitForSynthesis } from "@/lib/audio/textChunk";

/** Passage types worth narrating — everything else (image, code,
 * horizontalRule, table) has no meaningful spoken form and is skipped, same
 * scope TTSEngine.md's Chatterbox pipeline uses. */
export const NARRATABLE_TYPES: Passage["type"][] = [
  "paragraph",
  "heading",
  "blockquote",
  "listItem",
  "definitionList",
];

export function isNarratable(passage: Passage): boolean {
  return NARRATABLE_TYPES.includes(passage.type);
}

/**
 * isNarratable plus an actual-content check: a narratable *type* (say, a
 * heading) can still have nothing to say — no visible text, or text that's
 * entirely a footnote marker spokenPassageText strips away — and app/api/
 * narration/route.ts rejects an empty/whitespace-only synthesis request
 * outright (correctly: there's nothing to speak). Every place that decides
 * "is this a real passage to narrate" (which passages make up a section's
 * run, which one to jump/resume to, whether a click landed on something
 * speakable) needs this, not the bare type check, or an empty-text
 * passage could still get selected as the thing to play and then never
 * actually produce a clip.
 */
export function hasNarratableText(passage: Passage): boolean {
  return isNarratable(passage) && spokenPassageText(passage).trim().length > 0;
}

/**
 * Passage text for narration, with footnote/endnote reference markers
 * excised — Mark.kind === "note" ranges are the marker glyph itself (a
 * superscript "1" or "*") embedded inline in passage.text, the same
 * character a print reader's eye already skips over. Left in, TTS reads it
 * as a word ("one", "asterisk") mid-sentence instead of skipping it.
 */
export function spokenPassageText(passage: Passage): string {
  const noteMarks = (passage.marks ?? [])
    .filter((m) => m.kind === "note")
    .sort((a, b) => b.start - a.start);

  let text = passage.text;
  for (const mark of noteMarks) {
    text = text.slice(0, mark.start) + text.slice(mark.end);
  }
  return text;
}

/**
 * The pieces a passage's spoken text is actually synthesized as — pure text
 * splitting, no network call, so the client (liveNarrationCache.ts) can
 * enumerate a passage's chunks — and pick out any one chunk's exact text
 * to send to app/api/narration/route.ts for synthesis — without asking
 * the server anything first. A whole passage is always one chunk unless
 * it's long enough to need textChunk.ts's own size-budget split (rare) —
 * text is deliberately *not* pre-split into sentences for synthesis
 * anymore (see textChunk.ts's own doc comment): there is no reliable,
 * dependency-free way to guess a sentence boundary that's never wrong on
 * real prose (abbreviations, initials, decimals all defeat it), and a
 * wrong guess used to mean an actual standalone clip of just "Dr." or
 * "E." — an audible defect, not a shrug. Sending a whole passage as
 * continuous text sidesteps making that boundary decision at all: Edge TTS
 * gets the real sentence in one piece and produces correct prosody for it.
 * Word-level navigation (clicking any word) still works precisely off the
 * per-word timestamps the engine returns for that one clip — no sentence
 * splitting needed for that either.
 */
export function passageChunkTexts(passage: Passage): string[] {
  const text = spokenPassageText(passage);
  // Zero chunks, not one empty one — a passage with nothing actually
  // speakable (see hasNarratableText) shouldn't produce a chunk that's
  // just going to get rejected as an empty synthesis request. Callers
  // that use hasNarratableText to build their passage list won't hit this
  // in practice; it's the belt to that suspenders.
  if (text.trim().length === 0) return [];
  return splitForSynthesis(text);
}

/** Words, as narration counts them: \S+ runs — the count KaraokeWord.index,
 * every format's word highlight, and "listen from here" all share. */
export const countWords = (text: string) => text.match(/\S+/g)?.length ?? 0;

/** The index of the word at (or, from whitespace, just after) `offset`. */
export const wordIndexAt = (text: string, offset: number) => countWords(text.slice(0, offset).replace(/\S+$/, ""));

/** Each chunk's first word, as a passage-wide word index. */
export function chunkWordOffsets(passage: Passage): number[] {
  let n = 0;
  return passageChunkTexts(passage).map((t) => {
    const start = n;
    n += countWords(t);
    return start;
  });
}
