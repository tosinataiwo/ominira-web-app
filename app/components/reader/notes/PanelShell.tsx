"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { useNarrationBarHeight } from "@/app/components/useBottomDock";
import { useLayoutStore } from "@/stores/layout-store";

// The mobile sheet's height, as a fraction of the viewport — half by
// default (was a flat 82%, tall enough that the book underneath was barely
// scrollable at all with the panel up) so a reader can keep reading while a
// thread's open, with a drag on the grip pulling it up toward a near-full
// page for a longer thread/feed. Two named stops, not a free-floating
// continuous height, so a drag always lands somewhere legible ("is this
// actually expanded or just some in-between size?") rather than wherever
// the finger happened to lift.
const SHEET_HEIGHT_COLLAPSED = 0.5;
const SHEET_HEIGHT_EXPANDED = 0.96;
const SHEET_HEIGHT_DRAG_MIN = 0.3;
const SHEET_HEIGHT_DRAG_MAX = 0.97;

export default function PanelShell({
  panelType,
  side = "right",
  title,
  tabs,
  onBack,
  headerMenu,
  subheader,
  bodyClassName = "om-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-5 pb-10 flex flex-col gap-3.5",
  footer,
  onClose,
  children,
}: {
  panelType?: "side" | "sheet";
  /** Which edge the desktop "side" variant docks against — "right" (the
   * default, matching today's only two callers: the notes panel and the
   * book-wide feed) or "left" (the chapters outline, so it can push in from
   * the same side it already occupies as a flex sibling in Reader.tsx).
   * Mobile's "sheet" variant is unaffected — a bottom sheet has no left/
   * right to pick between. */
  side?: "left" | "right";
  /** A plain string for a simple title (the note panel), or any composed
   * block (e.g. a title + subtitle stack) for a panel that needs more —
   * ReactNode rather than a dedicated `subtitle` prop, so this stays the
   * one flexible slot instead of PanelShell growing a new prop per caller. */
  title?: ReactNode;
  /** A bare UnderlineTabs in place of the title — the tabs become the
   * header itself, sharing its bottom border with the close button beside
   * them (the book feed's Notes / Your highlights). */
  tabs?: ReactNode;
  /** Present only while drilled into a note's own reply thread — steps back
   * out to whichever thread was open before, one level at a time. */
  onBack?: () => void;
  /** Trailing header control before Close — the panel's own overflow menu
   * (e.g. Share passage / Delete highlight), rendered as a slot rather than
   * a fixed action since what belongs in it is entirely up to the caller. */
  headerMenu?: ReactNode;
  /** A pinned row below the header, above the scrollable body — e.g. the
   * book feed's browse bar (prev/next + jump). Stays visible while the
   * body beneath it scrolls, unlike anything passed as `children`. */
  subheader?: ReactNode;
  /** Overrides the scrollable body's own className — default is a padded
   * `flex flex-col gap-3.5` stack, right for every existing caller's list-
   * of-cards content. The chapters outline's rows manage their own spacing
   * already, so it opts out of the flex/gap wrapping (and uses a tighter
   * horizontal pad) via this instead of PanelShell growing a layout prop
   * per caller. */
  bodyClassName?: string;
  /** A pinned row below the scrollable body, bottom-docked like a chat
   * input bar — e.g. the book feed's own "share a thought" composer
   * (FeedPanel). Unlike `subheader`, this isn't part of the
   * scrolling content at all, so it stays reachable regardless of where
   * the reader has scrolled to and regardless of which tab/filter the body
   * itself currently shows. Safe to dock a real input here now that
   * NoteComposer's own expanded state is a `createPortal`'d overlay rather
   * than growing in place — the old iOS Safari keyboard-resize fight this
   * component's own doc comment used to warn about only applied to a
   * composer that grew *inline* inside a flex region; the idle pill this
   * slot actually holds is a fixed, non-growing row. */
  footer?: ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isSheet = panelType ? panelType === "sheet" : isMobile;
  // In a room, the sheet stands on the mini-player (and whatever it stands
  // on) rather than covering it: the room's controls stay in reach.
  const roomPlayerHeight = useLayoutStore((s) => s.roomPlayerHeight);
  const footerHeight = useLayoutStore((s) => s.readerFooterHeight);
  const narrationHeight = useNarrationBarHeight();
  const below = footerHeight + narrationHeight;
  const sheetClear =
    isSheet && roomPlayerHeight > 0
      ? `calc(${roomPlayerHeight + below}px${below === 0 ? " + env(safe-area-inset-bottom)" : ""})`
      : undefined;

  // Fresh per mount (this panel only ever mounts while open), so every open
  // starts back at the collapsed default regardless of where a previous
  // instance was left.
  const [sheetHeight, setSheetHeight] = useState(SHEET_HEIGHT_COLLAPSED);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number; moved: boolean } | null>(null);

  const onGripPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startHeight: sheetHeight, moved: false };
    setIsDragging(true);
  };
  const onGripPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaY = e.clientY - drag.startY;
    if (Math.abs(deltaY) > 4) drag.moved = true;
    // Dragging up (negative deltaY) grows the sheet — same sign flip every
    // bottom-sheet drag needs, since screen Y grows downward but height
    // should grow the opposite way.
    const nextHeight = drag.startHeight - deltaY / window.innerHeight;
    setSheetHeight(Math.min(SHEET_HEIGHT_DRAG_MAX, Math.max(SHEET_HEIGHT_DRAG_MIN, nextHeight)));
  };
  const onGripPointerEnd = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);
    if (!drag) return;
    // A tap (no real movement) toggles between the two stops outright —
    // discoverable without having to already know it's draggable. A real
    // drag instead snaps to whichever stop it ended up closer to.
    const midpoint = drag.startHeight >= (SHEET_HEIGHT_COLLAPSED + SHEET_HEIGHT_EXPANDED) / 2;
    setSheetHeight((h) =>
      !drag.moved
        ? midpoint
          ? SHEET_HEIGHT_COLLAPSED
          : SHEET_HEIGHT_EXPANDED
        : Math.abs(h - SHEET_HEIGHT_COLLAPSED) <= Math.abs(h - SHEET_HEIGHT_EXPANDED)
        ? SHEET_HEIGHT_COLLAPSED
        : SHEET_HEIGHT_EXPANDED
    );
  };

  return (
    // pointer-events-none — this box exists only to flex-align the real
    // panel below within Reader.tsx's already-narrow wrapper column; on
    // mobile in particular it's taller than the sheet itself (items-end
    // leaves the empty space above it), and none of that empty space
    // should ever intercept a scroll/tap meant for the book content behind
    // it. pointer-events-auto on the actual panel box below restores it.
    <div
      // min-h-dvh for the sheet only: the side panel fills its column, which
      // is shorter than the screen (the chapter footer sits below), and
      // overflowing it let the reader's resume scroll shift the panel up.
      className={`w-full h-full box-border relative flex overflow-hidden pointer-events-none ${
        isSheet ? "min-h-dvh justify-center items-end" : side === "left" ? "justify-start items-stretch" : "justify-end items-stretch"
      }`}
      style={sheetClear ? { paddingBottom: sheetClear } : undefined}
    >
      <div
        className={`max-w-full bg-[var(--reader-surface)] shadow-lg flex flex-col box-border overflow-hidden flex-none pointer-events-auto ${
          isSheet ? "w-full rounded-t-lg" : "w-95 h-full max-h-full border border-[var(--reader-border)]"
        }`}
        style={
          isSheet
            ? {
                height: `${sheetHeight * 100}%`,
                maxHeight: `${sheetHeight * 100}%`,
                transition: isDragging ? "none" : "height 220ms cubic-bezier(0.16, 1, 0.3, 1)",
              }
            : undefined
        }
      >
        {isSheet && (
          <div
            onPointerDown={onGripPointerDown}
            onPointerMove={onGripPointerMove}
            onPointerUp={onGripPointerEnd}
            onPointerCancel={onGripPointerEnd}
            role="slider"
            aria-label="Resize panel"
            aria-valuenow={Math.round(sheetHeight * 100)}
            aria-valuemin={Math.round(SHEET_HEIGHT_COLLAPSED * 100)}
            aria-valuemax={Math.round(SHEET_HEIGHT_EXPANDED * 100)}
            className="flex h-8 flex-none cursor-grab touch-none items-center justify-center select-none active:cursor-grabbing"
          >
            <div className="w-9 h-1 rounded-full bg-[var(--reader-border)]" />
          </div>
        )}
        {tabs ? (
          <div className={`px-5 ${isSheet ? "pt-1" : "pt-4"} flex-none flex items-end justify-between gap-2 border-b border-[var(--reader-border)]`}>
            <div className="min-w-0">{tabs}</div>
            <div className="flex items-center gap-3.5 flex-none pb-3">
              {headerMenu}
                <button onClick={onClose} aria-label="Close" className="flex bg-transparent border-none cursor-pointer text-[var(--reader-text-muted)] p-0">
                  <X size={16} />
                </button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 flex-none flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {onBack && (
                  <button
                    onClick={onBack}
                    className="flex-none bg-transparent border-none cursor-pointer text-[var(--reader-text-muted)] -ml-1 p-1"
                  >
                    <ArrowLeft size={16} />
                  </button>
              )}
              <span className="truncate font-serif font-semibold text-base text-[var(--reader-text)]">{title}</span>
            </div>
            <div className="flex items-center gap-3.5 flex-none">
              {headerMenu}
                <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-[var(--reader-text-muted)]">
                  <X size={16} />
                </button>
            </div>
          </div>
        )}
        {subheader && (
          <div className="flex-none border-b border-[var(--reader-border)] bg-[var(--reader-surface)]">
            {subheader}
          </div>
        )}
        <div className={bodyClassName}>{children}</div>
        {footer && (
          <div
            className="flex-none border-t border-[var(--reader-border)] bg-[var(--reader-surface)] px-5 py-3"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
