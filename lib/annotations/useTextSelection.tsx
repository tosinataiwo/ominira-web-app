"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AnnotationRange } from "@/lib/api/types";
import type { SelectionSurface, TextPoint } from "./surface";

/** Where the selection sits on screen (viewport coordinates) — what the
 * selection menu positions itself against. */
export type SelectionAnchor = { top: number; bottom: number; left: number; right: number };
export type TextSelection = { ranges: AnnotationRange[]; anchor: SelectionAnchor };

/** Marks the element a selection engine is bound to, so outside-tap handlers
 * (SelectionMenu's) can tell a tap on the reading surface — which the engine
 * handles itself — from one on surrounding chrome. */
export const SELECTION_SURFACE_ATTR = "data-selection-surface";

const LONG_PRESS_MS = 450;
/** A touch that moves further than this before the long-press fires is a
 * scroll, not a press. */
const TOUCH_SLOP_PX = 10;
/** A mouse press that moves further than this is a drag-select, not a click. */
const DRAG_THRESHOLD_PX = 4;
/** Dragging within this distance of the scroll container's top/bottom edge
 * scrolls it, so a selection can be carried past what's on screen. */
const EDGE_PX = 56;
const MAX_EDGE_SPEED_PX = 18;
const INTERACTIVE = "a, button, input, textarea, select, [contenteditable], [data-selection-ignore], [data-selection-handle]";
/** The selection handles — the highlight's own deeper gold, so the selection
 * reads as one colour. */
const HANDLE_COLOR = "var(--reader-highlight-border)";

type Sel = { anchor: TextPoint; focus: TextPoint; touch: boolean };
type Box = { top: number; left: number; width: number; height: number };

/**
 * The shared selection engine: turns long-presses, handle drags and mouse drags
 * on a reading surface into a text selection, draws it, and reports it — the
 * same behaviour on every format (EPUB, PDF, web article, DOCX), each of which
 * only supplies its surface's geometry (lib/annotations/surface.ts).
 *
 * Native selection is off on reading content (the caller renders it
 * `select-none no-callout`) because on iOS it's the only way to keep the
 * system's own Copy/Look Up/Translate menu from appearing alongside ours — a
 * web page can't suppress that menu while native selection is live. So the
 * engine owns all of it:
 *
 * - Touch: long-press selects the word; keep dragging to extend. Two handles
 *   then adjust either end. A plain drag still scrolls, and pinch still zooms.
 * - Mouse: press-drag selects, double-click selects a word, shift-click
 *   extends. ⌘/Ctrl+C copies.
 * - Dragging near the top or bottom edge scrolls, carrying the selection.
 * - A tap elsewhere, Escape, or the caller dropping it (`active` false)
 *   clears it.
 *
 * `onSelect` fires with the finished selection (ranges + where it is on
 * screen) when a gesture ends, again with a fresh anchor as the page scrolls,
 * and with null when the reader clears it. The caller owns what happens next
 * (the menu, highlighting, notes) and signals it's done by setting `active`
 * false.
 *
 * Returns the selection overlay, portalled into `scrollEl` so it scrolls with
 * the text it covers.
 */
export function useTextSelection({
  root,
  scrollEl,
  surface,
  active,
  onSelect,
  layoutKey,
  beneath = false,
}: {
  /** The element gestures are read from — the reading surface itself. */
  root: HTMLElement | null;
  /** The scrolling ancestor the overlay lives in (often `root` itself). */
  scrollEl: HTMLElement | null;
  surface: SelectionSurface | null;
  /** Whether the caller still shows this selection (its menu is up, etc.). */
  active: boolean;
  onSelect: (selection: TextSelection | null) => void;
  /** Changes whenever the surface's layout moves without the scroll container
   * resizing (a PDF zoom, a font-size change) — re-measures the overlay. */
  layoutKey?: unknown;
  /** Paint the wash behind the text, like a saved highlight, instead of
   * multiplying it over the top. For DOM text, whose `scrollEl` must be
   * `isolate` so "behind" stops at its background. Over the top is only for
   * an opaque page (PDF) — and leans on mix-blend-mode, which mobile WebKit
   * drops for layers inside a scroller, painting the ink over in yellow. */
  beneath?: boolean;
}): ReactNode {
  // The selection and its drawing, measured together: every change to the
  // selection happens in an event handler, which measures it there and then.
  const [view, setView] = useState<{ sel: Sel; boxes: Box[] } | null>(null);
  const selRef = useRef<Sel | null>(null);
  const committedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const ordered = useCallback(
    (s: Sel): [TextPoint, TextPoint] =>
      surface && surface.compare(s.anchor, s.focus) <= 0 ? [s.anchor, s.focus] : [s.focus, s.anchor],
    [surface]
  );

  /** The selection's rects, in the scroll container's content coordinates —
   * so the overlay, living inside the container, scrolls with the text. */
  const measure = useCallback(
    (s: Sel): Box[] => {
      if (!surface || !scrollEl) return [];
      const [start, end] = ordered(s);
      const origin = scrollEl.getBoundingClientRect();
      return surface.rectsFor(start, end).map((r) => ({
        top: r.top - origin.top + scrollEl.scrollTop - scrollEl.clientTop,
        left: r.left - origin.left + scrollEl.scrollLeft - scrollEl.clientLeft,
        width: r.width,
        height: r.height,
      }));
    },
    [surface, scrollEl, ordered]
  );

  const update = useCallback(
    (next: Sel | null) => {
      selRef.current = next;
      setView(next ? { sel: next, boxes: measure(next) } : null);
    },
    [measure]
  );

  const remeasure = useCallback(() => {
    const s = selRef.current;
    if (s) setView({ sel: s, boxes: measure(s) });
  }, [measure]);

  const clear = useCallback(
    (notify: boolean) => {
      const had = committedRef.current || selRef.current !== null;
      committedRef.current = false;
      update(null);
      if (notify && had) onSelectRef.current(null);
    },
    [update]
  );

  const emit = useCallback(() => {
    const s = selRef.current;
    if (!s || !surface) return;
    const [start, end] = ordered(s);
    const ranges = surface.rangesFor(start, end);
    const rects = surface.rectsFor(start, end);
    if (!ranges.length || !rects.length) {
      clear(true);
      return;
    }
    committedRef.current = true;
    onSelectRef.current({
      ranges,
      anchor: {
        top: Math.min(...rects.map((r) => r.top)),
        bottom: Math.max(...rects.map((r) => r.bottom)),
        left: Math.min(...rects.map((r) => r.left)),
        right: Math.max(...rects.map((r) => r.right)),
      },
    });
  }, [surface, ordered, clear]);

  // The caller is done with the selection (highlighted, noted, dismissed).
  useEffect(() => {
    if (!active && committedRef.current) clear(false);
  }, [active, clear]);

  // A different surface (a new section, a new document) starts clean.
  useEffect(() => () => clear(false), [surface, clear]);

  // ── Auto-scroll while dragging near an edge ─────────────────────────────
  const autoRef = useRef<{ frame: number; x: number; y: number; step: (x: number, y: number) => void } | null>(null);
  const stopAutoScroll = useCallback(() => {
    if (autoRef.current) cancelAnimationFrame(autoRef.current.frame);
    autoRef.current = null;
  }, []);
  const trackEdge = useCallback(
    (x: number, y: number, step: (x: number, y: number) => void) => {
      if (!scrollEl) return;
      const r = scrollEl.getBoundingClientRect();
      const speed =
        y < r.top + EDGE_PX
          ? -MAX_EDGE_SPEED_PX * Math.min(1, (r.top + EDGE_PX - y) / EDGE_PX)
          : y > r.bottom - EDGE_PX
            ? MAX_EDGE_SPEED_PX * Math.min(1, (y - (r.bottom - EDGE_PX)) / EDGE_PX)
            : 0;
      if (!speed) return stopAutoScroll();
      if (autoRef.current) {
        Object.assign(autoRef.current, { x, y, step });
        return;
      }
      const tick = () => {
        const a = autoRef.current;
        if (!a) return;
        const rr = scrollEl.getBoundingClientRect();
        const s =
          a.y < rr.top + EDGE_PX
            ? -MAX_EDGE_SPEED_PX * Math.min(1, (rr.top + EDGE_PX - a.y) / EDGE_PX)
            : a.y > rr.bottom - EDGE_PX
              ? MAX_EDGE_SPEED_PX * Math.min(1, (a.y - (rr.bottom - EDGE_PX)) / EDGE_PX)
              : 0;
        if (!s) return stopAutoScroll();
        scrollEl.scrollTop += s;
        a.step(a.x, a.y);
        a.frame = requestAnimationFrame(tick);
      };
      autoRef.current = { x, y, step, frame: requestAnimationFrame(tick) };
    },
    [scrollEl, stopAutoScroll]
  );

  // ── Gestures on the surface ─────────────────────────────────────────────
  useEffect(() => {
    if (!root || !surface) return;

    /** Swallows the click the browser synthesises at the end of a selecting
     * gesture, so finishing a selection on top of a highlight or a link doesn't
     * also open it. */
    const swallowNextClick = () => {
      const handler = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener("click", handler, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", handler, { capture: true }), 400);
    };

    // Mouse (and pen): drag to select.
    let mouse: { x: number; y: number; anchor: TextPoint; dragging: boolean } | null = null;
    const onMouseMove = (e: PointerEvent) => {
      if (!mouse) return;
      if (!mouse.dragging) {
        if (Math.hypot(e.clientX - mouse.x, e.clientY - mouse.y) < DRAG_THRESHOLD_PX) return;
        mouse.dragging = true;
        committedRef.current = false;
      }
      const extend = (x: number, y: number) => {
        const focus = surface.pointAt(x, y);
        if (mouse && focus) update({ anchor: mouse.anchor, focus, touch: false });
      };
      extend(e.clientX, e.clientY);
      trackEdge(e.clientX, e.clientY, extend);
    };
    const onMouseUp = () => {
      stopAutoScroll();
      window.removeEventListener("pointermove", onMouseMove);
      window.removeEventListener("pointerup", onMouseUp);
      if (!mouse) return;
      const { dragging } = mouse;
      mouse = null;
      if (dragging) {
        swallowNextClick();
        const s = selRef.current;
        if (s && surface.compare(s.anchor, s.focus) !== 0) emit();
        else clear(true);
      } else if (selRef.current) {
        // A plain click ends the selection, the way it does in any document.
        clear(true);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
      const p = surface.pointAt(e.clientX, e.clientY);
      if (!p) return;
      const current = selRef.current;
      if (e.shiftKey && current) {
        e.preventDefault();
        update({ ...current, focus: p });
        emit();
        return;
      }
      mouse = { x: e.clientX, y: e.clientY, anchor: p, dragging: false };
      window.addEventListener("pointermove", onMouseMove);
      window.addEventListener("pointerup", onMouseUp);
    };
    const onDoubleClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
      const p = surface.pointAt(e.clientX, e.clientY);
      const word = p && surface.wordAt(p);
      if (!word) return;
      update({ anchor: word.start, focus: word.end, touch: false });
      emit();
    };

    // Touch: long-press, then (optionally) keep dragging to extend.
    let press: { x: number; y: number; timer: ReturnType<typeof setTimeout>; moved: boolean } | null = null;
    let touchSelecting: { word: { start: TextPoint; end: TextPoint } } | null = null;
    const extendFromWord = (x: number, y: number) => {
      if (!touchSelecting) return;
      const q = surface.pointAt(x, y);
      if (!q) return;
      const { start, end } = touchSelecting.word;
      update(
        surface.compare(q, start) < 0
          ? { anchor: end, focus: q, touch: true }
          : { anchor: start, focus: surface.compare(q, end) > 0 ? q : end, touch: true }
      );
    };
    const onTouchStart = (e: TouchEvent) => {
      if (press) clearTimeout(press.timer);
      press = null;
      if (e.touches.length !== 1) return;
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
      const t = e.touches[0];
      const x = t.clientX;
      const y = t.clientY;
      press = {
        x,
        y,
        moved: false,
        timer: setTimeout(() => {
          const p = surface.pointAt(x, y);
          const word = p && surface.wordAt(p);
          if (!word) return;
          committedRef.current = false;
          touchSelecting = { word };
          update({ anchor: word.start, focus: word.end, touch: true });
          navigator.vibrate?.(8);
        }, LONG_PRESS_MS),
      };
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (touchSelecting) {
        // Extending the just-pressed selection: this touch is ours, not a scroll.
        if (e.cancelable) e.preventDefault();
        extendFromWord(t.clientX, t.clientY);
        trackEdge(t.clientX, t.clientY, extendFromWord);
        return;
      }
      if (press && Math.hypot(t.clientX - press.x, t.clientY - press.y) > TOUCH_SLOP_PX) {
        clearTimeout(press.timer);
        press.moved = true;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      stopAutoScroll();
      const wasTap = press && !press.moved && !touchSelecting;
      if (press) clearTimeout(press.timer);
      press = null;
      if (touchSelecting) {
        touchSelecting = null;
        if (e.cancelable) e.preventDefault(); // no synthetic click on what was pressed
        emit();
      } else if (wasTap && selRef.current) {
        clear(true);
      }
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    root.setAttribute(SELECTION_SURFACE_ATTR, "");
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("dblclick", onDoubleClick);
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", onTouchEnd);
    root.addEventListener("contextmenu", onContextMenu);
    return () => {
      if (press) clearTimeout(press.timer);
      stopAutoScroll();
      window.removeEventListener("pointermove", onMouseMove);
      window.removeEventListener("pointerup", onMouseUp);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("dblclick", onDoubleClick);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
      root.removeEventListener("contextmenu", onContextMenu);
      root.removeAttribute(SELECTION_SURFACE_ATTR);
    };
  }, [root, surface, update, emit, clear, trackEdge, stopAutoScroll]);

  // Escape clears; ⌘/Ctrl+C copies (native selection being off, the browser's
  // own copy has nothing to copy).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selRef.current || !surface) return;
      if (e.key === "Escape") {
        clear(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        const [start, end] = ordered(selRef.current);
        const text = surface
          .rangesFor(start, end)
          .map((r) => r.text ?? "")
          .join("\n");
        if (text) {
          e.preventDefault();
          void navigator.clipboard?.writeText(text);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [surface, ordered, clear]);

  // The menu follows the selection as the page scrolls.
  useEffect(() => {
    if (!scrollEl) return;
    let frame = 0;
    const onScroll = () => {
      if (!selRef.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Re-drawn too: on a virtualised surface (PDF) the pages under the
        // selection mount and unmount as the reader scrolls.
        remeasure();
        if (committedRef.current) emit();
      });
    };
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scrollEl, emit, remeasure]);

  // ── Drawing ─────────────────────────────────────────────────────────────
  // Re-measured when the text moves under it: the container or its content
  // resizing (a reflow, a font change), or the caller's own layout signal.
  useEffect(() => {
    if (!scrollEl) return;
    const observer = new ResizeObserver(remeasure);
    observer.observe(scrollEl);
    if (scrollEl.firstElementChild) observer.observe(scrollEl.firstElementChild);
    return () => observer.disconnect();
  }, [scrollEl, remeasure]);
  useEffect(() => {
    const frame = requestAnimationFrame(remeasure);
    return () => cancelAnimationFrame(frame);
  }, [layoutKey, remeasure]);

  const sel = view?.sel ?? null;
  const boxes = view?.boxes ?? [];

  // Handle drags (touch selections only — a mouse user just drags again).
  const startHandleDrag = useCallback(
    (which: "start" | "end", e: React.TouchEvent | React.PointerEvent) => {
      const s = selRef.current;
      if (!s || !surface) return;
      e.stopPropagation();
      const [start, end] = ordered(s);
      const fixed = which === "start" ? end : start;
      const drawn = view?.boxes ?? [];
      const edge = which === "start" ? drawn[0] : drawn[drawn.length - 1];
      const point = "touches" in e ? e.touches[0] : e;
      // Keep the finger's offset from the line it grabbed, so the handle
      // doesn't jump under the finger (and the finger doesn't hide the text).
      const origin = scrollEl!.getBoundingClientRect();
      const lineMidY = edge ? edge.top + edge.height / 2 - scrollEl!.scrollTop + origin.top : point.clientY;
      const offsetY = point.clientY - lineMidY;
      committedRef.current = false;
      const move = (x: number, y: number) => {
        const q = surface.pointAt(x, y - offsetY);
        if (q) update({ anchor: fixed, focus: q, touch: true });
      };
      const onMove = (ev: TouchEvent | PointerEvent) => {
        const p = "touches" in ev ? ev.touches[0] : ev;
        if (!p) return;
        if (ev.cancelable) ev.preventDefault();
        move(p.clientX, p.clientY);
        trackEdge(p.clientX, p.clientY, move);
      };
      const onEnd = () => {
        stopAutoScroll();
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onEnd);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        emit();
      };
      if ("touches" in e) {
        window.addEventListener("touchmove", onMove, { passive: false });
        window.addEventListener("touchend", onEnd);
      } else {
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onEnd);
      }
    },
    [surface, ordered, view, scrollEl, update, emit, trackEdge, stopAutoScroll]
  );

  if (!sel || !scrollEl || !boxes.length) return null;
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  return createPortal(
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute left-0 top-0 ${beneath ? "z-[-1]" : "reader-selection-layer z-[5]"}`}
      style={{ width: 0, height: 0 }}
    >
      {boxes.map((b, i) => (
        <div key={i} className="absolute" style={{ ...b, background: "var(--reader-highlight)", borderRadius: 2 }} />
      ))}
      {sel.touch && (
        <>
          <SelectionHandle x={first.left} top={first.top} height={first.height} knob="top" onStart={(e) => startHandleDrag("start", e)} />
          <SelectionHandle
            x={last.left + last.width}
            top={last.top}
            height={last.height}
            knob="bottom"
            onStart={(e) => startHandleDrag("end", e)}
          />
        </>
      )}
    </div>,
    scrollEl
  );
}

/** A selection handle: a thin bar the height of the line, with a round knob
 * above (start) or below (end) it — the same shape as the system's own. The
 * touch target is far larger than the drawing. */
function SelectionHandle({
  x,
  top,
  height,
  knob,
  onStart,
}: {
  x: number;
  top: number;
  height: number;
  knob: "top" | "bottom";
  onStart: (e: React.TouchEvent | React.PointerEvent) => void;
}) {
  const KNOB = 12;
  return (
    <div className="absolute" style={{ left: x - 1, top, width: 2, height, background: HANDLE_COLOR }}>
      <div
        className="absolute rounded-full"
        style={{
          width: KNOB,
          height: KNOB,
          left: 1 - KNOB / 2,
          [knob === "top" ? "top" : "bottom"]: -KNOB + 1,
          background: HANDLE_COLOR,
        }}
      />
      <div
        data-selection-handle=""
        className="pointer-events-auto absolute"
        style={{ width: 44, height: 44, left: 1 - 22, [knob === "top" ? "top" : "bottom"]: -30, touchAction: "none" }}
        onTouchStart={onStart}
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") onStart(e);
        }}
      />
    </div>
  );
}
