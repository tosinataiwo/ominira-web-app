import { useCallback, useEffect, useRef, useState } from "react";
import { chromeHiddenAfterScroll, isAtBottom } from "./useScrollChrome";

// Swipe must be clearly horizontal and past this distance before it's read as
// "turn the page" — otherwise an ordinary vertical scroll/drag inside a tall
// section would get misread as a page turn.
const MIN_SWIPE_PX = 60;
const HORIZONTAL_DOMINANCE = 1.5;

/**
 * Drives the section-carousel reader: which section (spine entry) is the
 * active "slide", how to move between slides, and the same chrome
 * hide/show + scroll-progress tracking useReaderChrome used to own — now
 * rebound to whichever slide is currently active instead of one shared
 * scroll container, since each section now owns its own vertical scroll.
 *
 * Two earlier approaches to the *visual* transition both got chased into
 * dead ends: a hand-rolled `transform: translateX` (fractional-pixel seams
 * near the header) and then Embla Carousel (a horizontal carousel whose
 * slides are ALSO independently tall, vertically-scrolling regions isn't a
 * shape those libraries are built for — it kept producing new rendering
 * bugs, not fewer). The fix is to stop trying to animate a slide-past
 * transition at all: only the active section is ever mounted, and moving to
 * another one is a plain React remount with a quick CSS fade (BookContent's
 * `key={section.id}` + the `reader-fade-in` animation), not a translated
 * DOM. Swipe/arrow/edge-click/keyboard are all still just *inputs* that
 * call `next`/`prev`/`goTo` — this hook only ever tracks an index and
 * detects gestures, it doesn't render anything itself.
 *
 * `goTo`/`goToSection` default to an animated (smooth-transition) move,
 * matching an adjacent swipe/arrow/edge-click turn. Passing
 * `{ animate: false }` (chapters-drawer jumps, search jumps, the
 * back-to-current nudge, Home/End) teleports instead — a multi-section
 * jump has no meaningful "in-between" to animate through. With no
 * translated DOM left, both paths behave identically except for whether
 * the fade-in plays; `animate` is threaded through mostly so callers don't
 * need to change and so a future "skip the fade on a teleport" tweak has
 * somewhere to hang.
 */
export function useSectionCarousel({
  sectionIds,
  onScroll,
  onNavigate,
  disabled,
}: {
  sectionIds: string[];
  onScroll?: () => void;
  /** Fires whenever `goTo` actually changes the active index (not on every
   * call — only when the clamped target differs from the current slide),
   * regardless of which of the many paths (keyboard, swipe, chapters
   * drawer, search, resume, narration auto-advance, back-to-current)
   * triggered it. */
  onNavigate?: () => void;
  disabled?: boolean;
}) {
  const total = sectionIds.length;

  // Always 0 on first render, on *both* server and client — this is what a
  // server-rendered page has to start on regardless of any saved position
  // (it never sees this reader's Bearer token, so it has no way to know
  // one), and the client's first hydration pass has to render identically
  // or React throws the whole tree away and regenerates it from scratch
  // (a real, user-visible failure this hook briefly had while a resume
  // target was being read into this as a lazy initializer — that ran during
  // the very render hydration compares against). Landing on the real saved
  // section is Reader.tsx's job now, via a `useLayoutEffect` `goTo` call
  // that runs strictly after hydration has already committed — see its own
  // comment for why that's still flash-free despite not being here.
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const goTo = useCallback(
    (index: number, opts?: { animate?: boolean }) => {
      void opts;
      const clamped = Math.min(Math.max(index, 0), total - 1);
      if (clamped !== activeIndexRef.current) onNavigate?.();
      setActiveIndex(clamped);
    },
    [total, onNavigate]
  );
  const goToSection = useCallback(
    (id: string, opts?: { animate?: boolean }) => {
      const idx = sectionIds.indexOf(id);
      if (idx >= 0) goTo(idx, opts);
    },
    [sectionIds, goTo]
  );
  const next = useCallback(() => goTo(activeIndexRef.current + 1, { animate: true }), [goTo]);
  const prev = useCallback(() => goTo(activeIndexRef.current - 1, { animate: true }), [goTo]);

  // Slide DOM refs, registered by whichever single section is currently
  // mounted, so other hooks (resume, narration follow-scroll and its
  // back-to-narration nudge, search) can scroll within a specific slide
  // once it's active. Only ever holds one entry at a time now, but stays a
  // Map keyed by id rather than a single ref — every caller already
  // navigates first and looks the element up a frame later (see
  // useResumeScroll, NarrationEngine), so this shape didn't need to
  // change when rendering did.
  const slideEls = useRef(new Map<string, HTMLDivElement>());
  const registerCallbacks = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const registerSlide = useCallback((id: string) => {
    let cb = registerCallbacks.current.get(id);
    if (!cb) {
      cb = (el) => {
        if (el) slideEls.current.set(id, el);
        else slideEls.current.delete(id);
      };
      registerCallbacks.current.set(id, cb);
    }
    return cb;
  }, []);
  const getSlideEl = useCallback((id: string) => slideEls.current.get(id), []);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 860);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const [chromeHidden, setChromeHidden] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  // Whether the active slide is scrolled to (or has no further to go past)
  // its own bottom — drives ChapterNavFooter's visibility (Reader.tsx): it
  // only surfaces once the reader has actually reached the end of the
  // current section, same "unobtrusive until needed" idea as the header.
  const [atBottom, setAtBottom] = useState(true);
  const lastScrollTopRef = useRef(0);
  const activeSectionId = sectionIds[activeIndex];

  useEffect(() => {
    const el = activeSectionId ? slideEls.current.get(activeSectionId) : undefined;
    if (!el) return;
    // A fast fling/scrollbar-drag toward either end of a long section fires
    // native `scroll` events far more often than the screen can paint —
    // each one was driving three separate setState calls (chrome
    // visibility, scroll%, atBottom) plus onScroll, so the resulting
    // render churn was what made that fast scroll feel janky rather than
    // smooth. Coalescing to one update per animation frame (the standard
    // scroll-throttle pattern) keeps the state in sync without doing more
    // work than the display can actually show.
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const top = el.scrollTop;
        const last = lastScrollTopRef.current;
        const hidden = chromeHiddenAfterScroll(top, last);
        if (hidden !== undefined) setChromeHidden(hidden);
        lastScrollTopRef.current = top;
        const max = el.scrollHeight - el.clientHeight;
        const intraFraction = max > 0 ? Math.min(1, Math.max(0, top / max)) : 0;
        setScrollPct(total > 0 ? (activeIndex + intraFraction) / total : 0);
        setAtBottom(isAtBottom(el));
        onScroll?.();
      });
    };
    // Reset the baseline to this slide's own current position — otherwise
    // the first delta after a page turn compares two unrelated slides'
    // scrollTop. Deliberately does NOT call handleScroll() here: that would
    // run the chrome hide/show branch against a scrollTop of 0 on every
    // fresh/unscrolled slide and force the header to reveal — animating
    // in right as the page turn is still settling, which is exactly what
    // produced an earlier seam-like glitch near the header. A page turn
    // should leave chrome visibility exactly as it was; only actual
    // scrolling (the listener below) should change it.
    lastScrollTopRef.current = el.scrollTop;
    const max = el.scrollHeight - el.clientHeight;
    const intraFraction = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
    setScrollPct(total > 0 ? (activeIndex + intraFraction) / total : 0);
    setAtBottom(isAtBottom(el));
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, activeSectionId, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      // This listener is on `window`, so it sees every keydown in the
      // document — including ones typed into the notes panel's textarea,
      // which is a DOM sibling of the book content, not a descendant (so
      // there's no ancestor to stopPropagation at). Without this guard,
      // typing a note hijacked Space/Arrow/Home/End as page-turn commands
      // instead of text input. isContentEditable is included for parity,
      // though nothing in the reader currently uses it.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prev();
      } else if (e.key === "Home") goTo(0, { animate: false });
      else if (e.key === "End") goTo(total - 1, { animate: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, next, prev, goTo, total]);

  // Pointer-based swipe gesture *detection* — this is purely an input
  // signal (did the reader drag far enough, mostly horizontally, to mean
  // "turn the page"), never a rendering transform. next()/prev() do the
  // rest via the plain state-driven remount above.
  //
  // Deliberately disabled outright on mobile (isMobile check below in both
  // handlers), not just narrowed to touch/pen pointers — on mobile, page
  // turning is the chapters drawer and the bottom nav only. This also
  // closes a real bug the touch/pen narrowing alone didn't: the chapters
  // drawer's mobile sheet only covers part of the screen, and the empty
  // space above it is pointer-events-none so a touch that lands just off
  // the sheet's small drag handle passes through to the book content
  // underneath — with swipe detection live there, that stray touch got
  // read as a page-turn swipe instead of doing nothing.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || isMobile) return;
      // Swipe-to-turn-page is a touch/pen gesture only — a mouse's own
      // click-and-drag is how a reader selects text, and treating that as
      // a swipe candidate too is what made an ordinary selection attempt
      // (one that, for whatever reason, didn't end up producing a real
      // native selection) misread as "turn the page," sometimes advancing
      // by two sections at once (see onPointerUp's own selection check
      // below — it can only catch a selection that actually landed).
      // Desktop already has the footer/keyboard for page-turning (see this
      // hook's own doc comment) — this only narrows *this* gesture path.
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      touchStart.current = { x: e.clientX, y: e.clientY };
    },
    [disabled, isMobile]
  );
  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (disabled || isMobile || !start) return;
      // A drag that produced an active text selection was a highlight
      // gesture, not a page-turn swipe — leave it alone.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) < MIN_SWIPE_PX || Math.abs(dx) < Math.abs(dy) * HORIZONTAL_DOMINANCE) return;
      if (dx < 0) next();
      else prev();
    },
    [disabled, isMobile, next, prev]
  );

  return {
    activeIndex,
    activeSectionId,
    goTo,
    goToSection,
    next,
    prev,
    registerSlide,
    getSlideEl,
    isMobile,
    chromeHidden,
    setChromeHidden,
    scrollPct,
    atBottom,
    onPointerDown,
    onPointerUp,
  };
}
