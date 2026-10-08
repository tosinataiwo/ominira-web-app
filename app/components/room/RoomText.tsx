"use client";

import { useEffect, useState } from "react";
import RoomAvatar from "./RoomAvatar";
import { useDockedHeight } from "@/app/components/useBottomDock";
import { comradeName } from "@/lib/reader/authorDisplay";
import { useBand, useFollowing, useMargin } from "@/lib/room/hooks";
import { spreadLines } from "@/lib/room/margin";
import { narratorName } from "@/lib/room/presence";
import type { ReaderView } from "@/lib/room/view";
import { useReaderStore } from "@/stores/reader-store";
import { useRoomStore } from "@/stores/room-store";

// The room in the text (spec §3.1, M3, M10 / D3, D7), drawn over the open
// reader in viewport coordinates: the frame round the reader while following, the
// quiet margin and the speaker band. Positions come
// from the reader's view (lib/room/view.ts) and are re-read as it scrolls.

/** Below the shell breakpoint: 22px margin avatars and a 6px frame inset. */
const NARROW_PX = 860;

export default function RoomText({ view }: { view: ReaderView }) {
  const theme = useReaderStore((s) => s.theme);
  useViewFrame(view);
  const docked = useDockedHeight();
  const bounds = view.bounds();
  if (!bounds) return null;
  // Text shows from below the reader's header to above the docked players.
  const bottom = Math.min(bounds.bottom, window.innerHeight - docked);
  const area = { top: bounds.top, bottom, left: bounds.left, right: bounds.right };
  const narrow = window.innerWidth < NARROW_PX;

  return (
    <>
      <SpeakerBand view={view} area={area} />
      <div data-reader-theme={theme} className="pointer-events-none fixed inset-0 z-[45]">
        <PageFrame left={area.left} right={area.right} inset={narrow ? 6 : 8} />
        <Margin view={view} area={area} size={narrow ? 22 : 26} />
      </div>
    </>
  );
}

type Area = { top: number; bottom: number; left: number; right: number };

/** Re-renders on the reader's scrolls (once a frame) and on resize. */
function useViewFrame(view: ReaderView) {
  const [, setFrame] = useState(0);
  useEffect(() => {
    let pending = 0;
    const tick = () => {
      if (!pending) pending = requestAnimationFrame(() => ((pending = 0), setFrame((n) => n + 1)));
    };
    const abort = new AbortController();
    view.root.addEventListener("scroll", tick, { capture: true, passive: true, signal: abort.signal });
    window.addEventListener("resize", tick, { signal: abort.signal });
    // Layout settles after a section turn or a font change without scrolling.
    const ro = new ResizeObserver(tick);
    ro.observe(view.root);
    return () => {
      abort.abort();
      ro.disconnect();
      cancelAnimationFrame(pending);
    };
  }, [view]);
}

/** 1.5px brand-300 frame while following (M3), round the whole reader:
 * its full width and the screen's full height. It drops once you move away. */
function PageFrame({ left, right, inset }: { left: number; right: number; inset: number }) {
  const following = useFollowing();
  if (!following || following.paused) return null;
  return (
    <div
      aria-hidden="true"
      className="absolute rounded-[14px] border-[1.5px] border-brand-300"
      style={{ top: inset, bottom: inset, left: left + inset, width: right - left - inset * 2 }}
    />
  );
}

/** Live mics, moderators and the one you follow, at their exact line
 * (spec §1.3). A tap follows (or stops following). */
function Margin({ view, area, size }: { view: ReaderView; area: Area; size: number }) {
  const margin = useMargin();
  const session = useRoomStore((s) => s.session);
  const following = useFollowing();
  const column = view.column();
  if (!column || !session || margin.length === 0) return null;
  // Just right of the text, kept on screen.
  const left = Math.min(column.right + 6, area.right - size - 4);
  const lines = margin.flatMap((m) => {
    const y = view.lineOf(m.place);
    return y === null ? [] : [{ ...m, y }];
  });

  return spreadLines(lines, size).map(({ member, top }) =>
    top < area.top || top + size > area.bottom ? null : (
      <div key={member.readerId} className="pointer-events-auto absolute transition-[top] duration-200" style={{ top, left }}>
        <RoomAvatar
          member={member}
          size={size}
          pressed={following?.member.readerId === member.readerId}
          onClick={() => session.follow(member.readerId)}
        />
      </div>
    ),
  );
}

/** A speaker's selection, captioned (spec §3.1), washed exactly like your
 * own selection: --reader-highlight on a .reader-selection-layer, which
 * multiplies in light theme and lies flat in dark (globals.css). The
 * wrapper only carries the theme those rules key off; it's no stacking
 * context, so the layer still blends with the page. */
function SpeakerBand({ view, area }: { view: ReaderView; area: Area }) {
  const theme = useReaderStore((s) => s.theme);
  const band = useBand();
  if (!band) return null;
  const rects = view.rectsFor(band.highlight.ranges).filter((r) => r.bottom > area.top && r.top < area.bottom);
  if (rects.length === 0) return null;
  const first = rects[0];
  const captionAbove = first.top - 28 > area.top;
  const last = rects[rects.length - 1];

  return (
    <div data-reader-theme={theme}>
      <div aria-hidden="true" className="reader-selection-layer pointer-events-none fixed inset-0 z-[45]">
        {rects.map((r, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              top: r.top,
              left: r.left,
              width: r.width,
              height: r.height,
              background: "var(--reader-highlight)",
              borderRadius: 2,
            }}
          />
        ))}
      </div>
      <p
        className="pointer-events-none fixed z-[45] max-w-[min(320px,80vw)] truncate rounded-full border border-[var(--reader-border)] bg-[var(--reader-surface)] px-2.5 py-0.5 text-xs text-[var(--reader-text-muted)] shadow-sm"
        style={{ top: captionAbove ? first.top - 26 : last.bottom + 4, left: Math.max(area.left + 8, first.left) }}
      >
        {narratorName(band.member) ? (
          <>
            {narratorName(band.member)} is narrating via{" "}
            <strong className="font-bold text-[var(--reader-text)]">{comradeName(band.member.name)}</strong>
          </>
        ) : (
          <>
            <strong className="font-bold text-[var(--reader-text)]">{comradeName(band.member.name)}</strong>{" "}
            {band.member.micOnAt !== null ? "is speaking from this passage" : "selected this passage"}
          </>
        )}
      </p>
    </div>
  );
}
