"use client";

import { useCallback, useRef, useState } from "react";
import type { Locator } from "@/lib/reader/locator";
import { useDocumentProgress } from "@/lib/reader/useDocumentProgress";

/** Matches useReadingProgress's own tolerance for "still showing at the top" —
 * a block whose last sliver is technically above the line hasn't been read
 * *past* in any meaningful sense. */
const TOP_TOLERANCE_PX = 8;

/**
 * The reference line a block is measured against: the top of the scroll
 * container's own content box, i.e. below its padding. Using the padding edge
 * rather than the border box matters because that padding is what clears the
 * fixed reader header — measuring from the border box would read (and
 * restore) a block sitting *underneath* the header as the current one.
 */
function contentTopOf(scrollEl: HTMLElement): number {
  const paddingTop = parseFloat(getComputedStyle(scrollEl).paddingTop) || 0;
  return scrollEl.getBoundingClientRect().top + paddingTop;
}

const WRAPPER_TAGS = new Set(["DIV", "SECTION", "ARTICLE", "MAIN"]);

/**
 * An article's blocks: the content element's top-level children — looking
 * through a lone wrapper first (Readability puts every extracted article in
 * one `div.page`, which would otherwise make the whole article one block).
 * Shared with the article selection surface (useArticleAnnotations), so
 * "block 17" means the same element to progress and to saved highlights.
 */
export function articleBlocks(contentEl: HTMLElement): HTMLElement[] {
  let el: Element = contentEl;
  while (
    el.childElementCount === 1 &&
    WRAPPER_TAGS.has(el.firstElementChild!.tagName) &&
    !Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())
  ) {
    el = el.firstElementChild!;
  }
  return Array.from(el.children) as HTMLElement[];
}

/**
 * Resume + progress tracking for the reflowable single-document viewers
 * (DOCX, extracted web articles) — the `block` locator kind's own half of
 * useDocumentProgress, shared by both because they render identically: one
 * scrolling container wrapping one `.reader-article` element whose top-level
 * children are the blocks (see articleBlocks).
 *
 * A block index, not a scroll offset or fraction: the text reflows with the
 * viewport (the reading tokens change size at 768px), which reflows everything and invalidates any pixel-based position, while
 * the block sequence itself is stable.
 *
 * Returns the two refs to attach. They're callback refs rather than plain ref
 * objects on purpose: "the article is in the DOM" is itself the readiness
 * signal this hook waits on before restoring a position, and a plain ref's
 * mutation can't wake anything up to notice.
 */
export function useArticleProgress({ materialId, urlLocator }: { materialId: string; urlLocator: Locator | undefined }) {
  // The elements live in refs (this hook *scrolls* one of them, which is a
  // mutation React state isn't for), while the one fact the hooks below need
  // to re-run on — "is the article mounted, and how many blocks does it have"
  // — is derived once at attach time and kept in state. That's also the
  // cheapest possible place to count blocks: they're all in the DOM by the
  // time the element they belong to is attached.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [{ ready, blockCount }, setArticleState] = useState({ ready: false, blockCount: 0 });
  // The same element as `scrollRef`, kept in state as well because
  // useDocumentKeyboard binds a listener *per container* and so needs the
  // attach to be an effect dependency, which a ref mutation can't be.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

  const syncArticleState = useCallback(() => {
    const contentEl = contentRef.current;
    setArticleState({
      ready: scrollRef.current !== null && contentEl !== null,
      blockCount: contentEl ? articleBlocks(contentEl).length : 0,
    });
  }, []);
  const setScrollEl = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      setScrollElement(el);
      syncArticleState();
    },
    [syncArticleState]
  );
  const setContentEl = useCallback(
    (el: HTMLDivElement | null) => {
      contentRef.current = el;
      syncArticleState();
    },
    [syncArticleState]
  );

  const read = useCallback((): Extract<Locator, { kind: "block" }> | undefined => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return undefined;
    const blocks = articleBlocks(contentEl);
    if (blocks.length === 0) return undefined;
    const line = contentTopOf(scrollEl) + TOP_TOLERANCE_PX;
    // The first block not yet scrolled past the reference line — i.e.
    // whatever is showing at the top right now. Scrolled past every block
    // (resting at the very end of the document) resolves to the last one,
    // which is still the honest resume point.
    const index = blocks.findIndex((block) => block.getBoundingClientRect().bottom > line);
    return { kind: "block", blockIndex: index >= 0 ? index : blocks.length - 1 };
  }, []);

  const apply = useCallback((locator: Extract<Locator, { kind: "block" }>) => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;
    const block = articleBlocks(contentEl)[locator.blockIndex];
    if (!block) return;
    // Relative rather than scrollIntoView: this is a scroll container nested
    // in a fixed-height layout, and scrollIntoView would also move whatever
    // ancestors it decides are in the way.
    scrollEl.scrollTop += block.getBoundingClientRect().top - contentTopOf(scrollEl);
  }, []);

  const getScrollElement = useCallback(() => scrollRef.current, []);
  const { getPositionNow, resumeApplied } = useDocumentProgress({
    materialId,
    kind: "block",
    urlLocator,
    scale: blockCount > 0 ? { kind: "block", blockCount } : undefined,
    contentReady: ready,
    getScrollElement,
    apply,
    read,
  });

  // The refs are returned as callbacks: attaching is what tells this hook the
  // article exists, which a plain ref object couldn't signal. `getPositionNow`
  // is for DocumentEndPanel — see useDocumentProgress. `resumeApplied`: the
  // reader has landed (a live room starts reading the position from then).
  return { scrollRef: setScrollEl, contentRef: setContentEl, scrollElement, getPositionNow, resumeApplied };
}
