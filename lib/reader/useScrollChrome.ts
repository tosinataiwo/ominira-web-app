import { useEffect, useState } from "react";

/** How far (px) the reader has to scroll in one direction before the chrome
 * reacts — enough to ignore jitter and momentum wobble. */
const SCROLL_SLOP_PX = 4;

/** The reader chrome's scroll rule, shared by every format: scrolling down
 * hides it, scrolling up (or reaching the top) brings it back, and anything
 * smaller than the slop leaves it as it was (`undefined`). */
export function chromeHiddenAfterScroll(top: number, last: number): boolean | undefined {
  if (top <= 0 || top < last - SCROLL_SLOP_PX) return false;
  if (top > last + SCROLL_SLOP_PX) return true;
  return undefined;
}

/** Whether `el` is scrolled to (or has nowhere further to go past) its bottom. */
export function isAtBottom(el: HTMLElement): boolean {
  const max = el.scrollHeight - el.clientHeight;
  return max <= 0 || el.scrollTop >= max - SCROLL_SLOP_PX;
}

/**
 * Scroll-driven chrome visibility for a single scrolling document (PDF, DOCX,
 * web article) — the same signals the EPUB reader gets from useSectionCarousel,
 * so the reader chrome (the notes rail in particular) shows, hides and folds
 * the same way in every format. One update per animation frame, like the
 * carousel's, so a fast fling doesn't churn renders.
 */
export function useScrollChrome(el: HTMLElement | null) {
  const [hidden, setHidden] = useState(false);
  const [atBottom, setAtBottom] = useState(false);

  useEffect(() => {
    if (!el) return;
    let last = el.scrollTop;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = el.scrollTop;
      // More than a screen in one frame is the app jumping (restoring the
      // saved position, a feed entry's "jump to"), not the reader scrolling —
      // it moves the baseline but leaves the chrome as it was.
      if (Math.abs(top - last) <= el.clientHeight) {
        const next = chromeHiddenAfterScroll(top, last);
        if (next !== undefined) setHidden(next);
      }
      last = top;
      setAtBottom(isAtBottom(el));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [el]);

  return { hidden, atBottom };
}
