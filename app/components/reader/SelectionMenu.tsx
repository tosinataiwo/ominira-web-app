"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Theme } from "@/stores/reader-store";
import type { SelectionAnchor } from "@/lib/reader/useTextAnnotations";
import { SELECTION_SURFACE_ATTR } from "@/lib/annotations/useTextSelection";

export type Item = { key: string; icon: ReactNode; label: string; onClick: () => void; danger?: boolean };

type Props = {
  /** The selection's own bounding rect (viewport coordinates) — the
   * desktop pill measures itself against this to clamp/flip and stay fully
   * on screen. Unused on mobile (see isMobile below), which anchors to the
   * bottom of the screen instead regardless of where the selection is. */
  anchor: SelectionAnchor;
  /** On mobile this renders as a bar pinned to the bottom of the screen
   * instead of a pill floating above the selection — iOS's own native
   * selection callout (Copy/Look Up/Translate) always centers itself
   * directly above the selection, and there's no supported way to suppress
   * that native UI on a regular web page, so a floating pill there just
   * fights it for the same real estate. Anchoring to the bottom instead
   * sidesteps the collision entirely (and keeps the native drag-handles
   * fully working, unlike clearing the native selection would). Desktop
   * has no such native menu, so it keeps the floating pill. */
  isMobile: boolean;
  /** How far above the bottom edge to sit (mobile only) — stacks above the
   * persistent NowPlayingBar when a book is being listened to, matching the
   * same bottomOffsetPx pattern ChapterNavFooter already uses. */
  bottomOffsetPx: number;
  /** Drives the pill's invert-against-the-page treatment below — not read
   * from the reader's own CSS theme vars, since this deliberately goes the
   * *opposite* direction of the page it floats over. */
  theme: Theme;
  /** Caller builds its own icon/label/action list — this component only
   * knows how to lay one out and float it, not what it means. The selection
   * actions themselves are defined once, in SelectionActions. */
  items: Item[];
  /** Renders in place of `items` (both the desktop pill and the mobile
   * bottom bar) when present — reuses this component's own clamped-position/
   * dismiss mechanics for content that isn't an action list, e.g. the
   * signed-out MembersOnlyPrompt or a brief "couldn't save" message after a
   * failed optimistic write (see SelectionActions). */
  override?: ReactNode;
  onDismiss: () => void;
};

// A consistent, theme-independent danger red — the inverted pill already
// guarantees contrast against the page behind it, so this just needs to
// read as "destructive" against the pill's own near-black/near-white fill.
const DANGER_COLOR = "#f26b6b";

const VIEWPORT_MARGIN = 8;

/**
 * Floating action pill, shown on text selection or on clicking an existing
 * mark. A fixed-position overlay rendered outside BookContent's scrollable
 * tree, so selecting text never forces the (memoized) book content to
 * re-render.
 *
 * Inverts against the reading page (note-redesign.md): a light page gets a
 * near-black pill, a dark page gets a near-white one — the same idiom as a
 * native OS tooltip landing on arbitrary content, and it guarantees contrast
 * regardless of what's behind it without needing per-theme tuning.
 *
 * Two layouts, picked via isMobile (see the Props doc above for why):
 * desktop floats a pill above/below the selection (measure-then-place,
 * since its width varies with which actions are showing); mobile is a
 * fixed bottom bar, position independent of the selection entirely.
 */
export default function SelectionMenu({ anchor, isMobile, bottomOffsetPx, theme, items, override, onDismiss }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; flipped: boolean } | null>(null);

  useLayoutEffect(() => {
    if (isMobile) return;
    const el = rootRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();

    let left = anchor.left;
    left = Math.min(left, window.innerWidth - width - VIEWPORT_MARGIN);
    left = Math.max(left, VIEWPORT_MARGIN);

    // Prefer floating above the selection (matches the old fixed -48px
    // offset); flip below it instead when there isn't room above — e.g. a
    // selection starting right at the top of the viewport. The little
    // pointer triangle (below) tracks which side won so it stays attached
    // to the edge nearest the selection either way.
    let top = anchor.top - height - 12;
    const flipped = top < VIEWPORT_MARGIN;
    if (flipped) top = anchor.bottom + 12;
    top = Math.min(top, window.innerHeight - height - VIEWPORT_MARGIN);
    top = Math.max(top, VIEWPORT_MARGIN);

    setPos({ top, left, flipped });
  }, [isMobile, anchor]);

  // Tapping anywhere that isn't the pill itself and isn't inside a reading
  // section dismisses it — content-area taps already end the selection via
  // onTextSelect's own touchend/mouseup handler (see useTextAnnotations.ts),
  // so this only needs to cover chrome outside that (header, rail, etc.).
  // A listener, not an overlay element, so it never sits in the hit-test
  // path and can't block scrolling the way the old full-screen catcher did.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      // Taps on a reading surface are the selection engine's own to handle
      // (lib/annotations/useTextSelection).
      if ((target as HTMLElement).closest?.(`[${SELECTION_SURFACE_ATTR}], [data-section-id]`)) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [onDismiss]);

  const inverted = theme === "light";
  const bg = inverted ? "#0a0a0a" : "#fdfbf8";
  const fg = inverted ? "#fdfbf8" : "#0a0a0a";
  const divider = inverted ? "rgba(255,255,255,.15)" : "rgba(0,0,0,.12)";
  const shadow = inverted ? "var(--shadow-md)" : "var(--shadow-lg)";

  if (isMobile) {
    return (
      <div
        ref={rootRef}
        style={override ? { bottom: bottomOffsetPx } : { bottom: bottomOffsetPx, background: bg, boxShadow: shadow }}
        className={
          override
            ? "reader-menu-in fixed inset-x-0 z-30 select-none no-callout p-3"
            : "reader-menu-in fixed inset-x-0 z-30 flex items-stretch justify-around select-none no-callout"
        }
      >
        {override ??
          items.map((item) => (
            <button
              key={item.key}
              onClick={item.onClick}
              style={{ color: item.danger ? DANGER_COLOR : fg }}
              className="flex-1 flex flex-col items-center justify-center gap-1 bg-transparent border-none py-2.5 cursor-pointer text-[11px] font-semibold"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      style={{
        top: pos?.top ?? anchor.top,
        left: pos?.left ?? anchor.left,
        ...(override ? {} : { background: bg, boxShadow: shadow }),
        // Invisible until the first measure/clamp pass has run — otherwise
        // there'd be a one-frame flash at the raw (unclamped) anchor
        // position before it jumps to its real, on-screen spot.
        visibility: pos ? "visible" : "hidden",
      }}
      className={
        override
          ? "reader-menu-in fixed rounded-md z-30 select-none no-callout w-64"
          : "reader-menu-in fixed flex items-center gap-px rounded-md p-1 z-30 select-none no-callout"
      }
    >
      {!override && (
        <div
          style={{ background: bg }}
          className={`absolute left-5 w-2 h-2 rotate-45 rounded-xs ${pos?.flipped ? "-top-1" : "-bottom-1"}`}
        />
      )}
      {override ??
        items.map((item, i) => (
          <div key={item.key} className="flex items-center">
            {i > 0 && <div style={{ background: divider }} className="w-px h-4 mx-0.5 flex-none" />}
            <button
              onClick={item.onClick}
              style={{ color: item.danger ? DANGER_COLOR : fg }}
              className="flex items-center gap-1.5 bg-transparent border-none py-1.75 px-3 rounded-full cursor-pointer text-xs font-semibold whitespace-nowrap"
            >
              {item.icon}
              {item.label}
            </button>
          </div>
        ))}
    </div>
  );
}
