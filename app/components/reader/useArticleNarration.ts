"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAudioStore } from "@/stores/audio-store";
import { useNarrationStore } from "@/stores/narration-store";
import {
  articleBlockIndex,
  articleNarrationDocument,
  articleWordIndexAt,
  articleWordRange,
} from "@/lib/audio/articleNarration";
import { indexOfBlockId } from "@/lib/annotations/surface";
import { articleBlocks } from "@/lib/reader/useArticleProgress";
import { useNarratedWord } from "./useNarratedWord";

/** The CSS Custom Highlight the narrated word is painted with (globals.css) —
 * a highlight, not a wrapping span, so the article's own DOM (which saved
 * highlights are anchored to) is never touched. */
const HIGHLIGHT = "om-narrating-word";

/**
 * Listening for DOCX and web articles: the header's Listen button, and
 * Listen on a selection (`listenFrom`). Playback
 * itself is the shared NarrationEngine's, fed by articleNarrationDocument;
 * ArticleNarrationFollower does the per-word work.
 */
export function useArticleNarration({
  materialId,
  title,
  contentEl,
}: {
  materialId: string;
  title: string;
  contentEl: HTMLElement | null;
}) {
  const isListen = useAudioStore((s) => s.book?.id === materialId);
  const openBook = useAudioStore((s) => s.openBook);
  const onListen = useCallback(() => {
    if (contentEl) openBook(articleNarrationDocument({ materialId, title, contentEl }), materialId);
  }, [contentEl, materialId, title, openBook]);
  /** From the word at a selection's start: `block` and `offset` as the
   * selection surface gives them. */
  const listenFrom = useCallback(
    (block: string, offset: number) => {
      const index = indexOfBlockId(block);
      const el = contentEl ? articleBlocks(contentEl)[index] : undefined;
      if (!contentEl || !el) return;
      const passageId = `block-${index}`;
      const wordIndex = articleWordIndexAt(el, offset);
      if (isListen) useNarrationStore.getState().seekToPassageForListening("article", passageId, wordIndex);
      else
        useAudioStore
          .getState()
          .openBookAtPassage(articleNarrationDocument({ materialId, title, contentEl }), materialId, "article", passageId, wordIndex);
    },
    [contentEl, isListen, materialId, title]
  );
  return { listen: { canListen: Boolean(contentEl?.textContent?.trim()), isListen, onListen }, listenFrom };
}

/**
 * The word highlight — your narration's, or a room speaker's — and keeping
 * the narrated block on screen. Its own
 * component because it re-renders on every playback tick, which the
 * article view itself shouldn't.
 */
export function ArticleNarrationFollower({
  materialId,
  contentEl,
  scrollEl,
}: {
  materialId: string;
  contentEl: HTMLElement | null;
  scrollEl: HTMLElement | null;
}) {
  // Yours, or a room speaker's reading aloud to you.
  const word = useNarratedWord(materialId);
  const block = contentEl && word ? articleBlocks(contentEl)[articleBlockIndex(word.passageId)] : undefined;
  const wordIndex = word?.index ?? -1;

  useEffect(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const range = block && wordIndex >= 0 ? articleWordRange(block, wordIndex) : undefined;
    if (range) CSS.highlights.set(HIGHLIGHT, new Highlight(range));
    else CSS.highlights.delete(HIGHLIGHT);
  }, [block, wordIndex]);
  useEffect(
    () => () => {
      if (typeof CSS !== "undefined" && "highlights" in CSS) CSS.highlights.delete(HIGHLIGHT);
    },
    []
  );

  // Brings the block narration starts on into view, then follows it onto
  // the next block only while the reader is following: the block just
  // finished was on screen and the new one isn't fully. A reader who
  // scrolled away is left where they are.
  const prevBlockRef = useRef<Element | undefined>(undefined);
  useEffect(() => {
    const prev = prevBlockRef.current;
    prevBlockRef.current = block;
    if (!block || prev === block || !scrollEl) return;
    const view = scrollEl.getBoundingClientRect();
    const top = view.top + (parseFloat(getComputedStyle(scrollEl).paddingTop) || 0);
    const onScreen = (r: DOMRect) => r.bottom > top && r.top < view.bottom;
    const b = block.getBoundingClientRect();
    if (prev ? !onScreen(prev.getBoundingClientRect()) : onScreen(b)) return;
    if (b.top >= top && b.bottom <= view.bottom) return;
    scrollEl.scrollTo({ top: scrollEl.scrollTop + b.top - top, behavior: "smooth" });
  }, [block, scrollEl]);

  return null;
}
