"use client";

import { useEffect, useRef, useState } from "react";
import { Hand, Maximize2 } from "lucide-react";
import FollowPill, { JumpPrompt } from "./FollowPill";
import MicToggle from "./MicToggle";
import { ReactButton, RisingReactions } from "./Reactions";
import RoomAvatar from "./RoomAvatar";
import { useBottomDock, useNarrationBarHeight } from "@/app/components/useBottomDock";
import { isIOSDevice } from "@/lib/pwa/platform";
import { useFollowing, useReaderView, useRoom, useRoomControls, useSpeaking, useVoices } from "@/lib/room/hooks";
import { micBlockedHelp } from "@/lib/room/mic";
import { speakingLine } from "@/lib/room/presence";
import { useDebounced } from "@/lib/time/useDebounced";
import { useLayoutStore } from "@/stores/layout-store";
import { useRoomStore } from "@/stores/room-store";
import { showToast } from "@/stores/toast-store";

// The room's mini-player (spec §1.2): in the app shell, so it survives
// leaving the reader. Mobile is a card (C1); from the shell breakpoint it's
// a dock floating at the foot of the page, max 720px (C2). It stacks above
// the narration bar when both are showing. Its status line carries the
// states of spec §10. In the book's reader, the follow pill and the Jump
// prompt sit above it.

const button =
  "flex h-11 items-center justify-center gap-2 rounded-md border px-3.5 text-[15px] font-semibold whitespace-nowrap cursor-pointer transition-colors disabled:cursor-default disabled:opacity-50 shell:h-10 shell:flex-none";

const IOS_NOTE_KEY = "ominira-room-ios-note";

export default function RoomMiniPlayer() {
  const dock = useBottomDock();
  const narrationHeight = useNarrationBarHeight();
  const setRoomPlayerHeight = useLayoutStore((s) => s.setRoomPlayerHeight);
  const setPanelOpen = useRoomStore((s) => s.setPanelOpen);
  // The desktop room panel is as wide as the reader's notes panel.
  const panelOpen = useRoomStore((s) => s.panelOpen);
  const leave = useRoomStore((s) => s.leave);
  const join = useRoomStore((s) => s.join);
  const session = useRoomStore((s) => s.session);
  const controls = useRoomControls();
  const micsOn = useSpeaking();
  const voices = useVoices();
  const title = useRoom((s) => s.room.title);
  const roomId = useRoom((s) => s.room.id);
  // Who the player shows: who's talking, else a live mic, else a moderator, else you.
  const featured = useRoom(
    (s) =>
      voices?.[0] ??
      micsOn?.[0] ??
      s.roster.find((p) => p.isModerator) ??
      s.roster.find((p) => p.readerId === s.readerId),
  );
  const me = useRoom((s) => s.readerId);
  const followingId = useFollowing()?.member.readerId;
  const inReader = useReaderView() !== null;
  const iosNote = useIosNote();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setRoomPlayerHeight(entries[0].contentRect.height));
    ro.observe(el);
    return () => {
      ro.disconnect();
      setRoomPlayerHeight(0);
    };
  }, [setRoomPlayerHeight]);

  const status = !controls
    ? ""
    : controls.elsewhere
      ? "This room is open in another tab"
      : controls.connection === "connecting"
        ? "Connecting…"
        : controls.micState === "blocked" && !controls.micOn
          ? "Mic blocked"
          : controls.reconnecting
            ? "Reconnecting…"
            : (speakingLine(voices ?? []) ?? "Nobody's speaking");
  // Screen readers hear the line once it settles, not every flicker of who's talking.
  const announced = useDebounced(status, 1500);

  if (!controls || !session) return null;
  const { handRaised, connection, elsewhere, audioSuspended } = controls;
  const blocked = status === "Mic blocked";

  return (
    <div
      ref={ref}
      data-reader-theme={dock.theme}
      className={`${dock.className} ${panelOpen ? "shell:right-95" : ""} pointer-events-none flex flex-col gap-2 px-3 pb-3 shell:items-center shell:px-6`}
      style={{ bottom: dock.bottom + narrationHeight }}
    >
      {inReader && !elsewhere && (
        <div className="flex flex-wrap justify-center gap-2 empty:hidden">
          <JumpPrompt />
          <FollowPill />
        </div>
      )}
      <div className="pointer-events-auto relative flex flex-col gap-3 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] px-3.5 pt-3.5 pb-1.5 shadow-md shell:w-full shell:max-w-[720px] shell:flex-row shell:flex-wrap shell:items-center shell:gap-x-4 shell:gap-y-2 shell:py-3 shell:pr-13 shell:pl-3.5">
        {!elsewhere && <RisingReactions />}
        {!elsewhere && (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            aria-label="Open the room"
            title="Open the room"
            className="absolute top-2.5 right-2.5 flex h-9 w-9 cursor-pointer items-center justify-center rounded-sm text-[var(--reader-text-muted)] hover:bg-[var(--reader-surface-hover)] hover:text-[var(--reader-text)] shell:top-1.5 shell:right-1.5 shell:h-8 shell:w-8"
          >
            <Maximize2 size={18} strokeWidth={1.75} />
          </button>
        )}

        <div className="flex min-w-0 items-center gap-3 pr-10 shell:flex-1 shell:pr-0">
          {featured && (
            <RoomAvatar
              member={featured}
              size={40}
              pressed={featured.readerId === followingId}
              onClick={featured.readerId !== me && !elsewhere ? () => session.follow(featured.readerId) : undefined}
            />
          )}
          <div className="flex min-w-0 flex-col items-start gap-0.5">
            <span className="max-w-full truncate text-[15px] font-semibold text-[var(--reader-text)]">{title}</span>
            {audioSuspended && !elsewhere ? (
              <button
                type="button"
                onClick={() => void session.resumeAudio()}
                className="max-w-full cursor-pointer truncate text-xs font-bold text-[var(--reader-accent)] underline underline-offset-2"
              >
                Tap to resume audio
              </button>
            ) : (
              <span className="flex max-w-full items-baseline gap-1.5 text-xs font-bold">
                <span className="truncate text-[var(--reader-accent)]">{status}</span>
                {blocked && (
                  <button
                    type="button"
                    onClick={() => showToast(micBlockedHelp(navigator.userAgent, isIOSDevice()))}
                    className="flex-none cursor-pointer text-[var(--reader-text-muted)] underline underline-offset-2 hover:text-[var(--reader-text)]"
                  >
                    How to allow it
                  </button>
                )}
              </span>
            )}
            <span aria-live="polite" className="sr-only">
              {announced}
            </span>
            <button
              type="button"
              onClick={() => void leave()}
              className="-ml-1.5 hidden h-6.5 cursor-pointer rounded-sm px-1.5 text-xs font-bold text-[var(--reader-text-muted)] hover:text-[var(--reader-text)] shell:block"
            >
              Leave room
            </button>
          </div>
        </div>

        {elsewhere ? (
          // Joining again here makes the other tab yield instead.
          <button
            type="button"
            onClick={() =>
              void join(roomId!).catch((err) => showToast(err instanceof Error ? err.message : "Couldn't join the room."))
            }
            className={`${button} border-[var(--reader-accent)] bg-transparent text-[var(--reader-accent)]`}
          >
            Use here
          </button>
        ) : (
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2.5 shell:flex shell:items-center shell:gap-2">
            <MicToggle className={button} />
            <button
              type="button"
              disabled={connection === "connecting"}
              aria-pressed={handRaised}
              onClick={() => (handRaised ? session.lowerHand() : session.raiseHand())}
              className={`${button} ${
                handRaised
                  ? "border-[var(--reader-accent)] bg-[color-mix(in_srgb,var(--reader-accent)_10%,var(--reader-surface))] text-[var(--reader-accent)]"
                  : "border-[var(--reader-border)] bg-[var(--reader-surface)] text-[var(--reader-text)]"
              }`}
            >
              <Hand size={18} strokeWidth={1.75} />
              {handRaised ? "Lower hand" : "Raise hand"}
            </button>
            <ReactButton className={button} disabled={connection === "connecting"} />
          </div>
        )}

        {iosNote && !elsewhere && (
          <p className="text-xs text-[var(--reader-text-muted)] shell:basis-full">
            Keep Ominira open to keep listening. Audio stops when your screen locks.
          </p>
        )}

        <button
          type="button"
          onClick={() => void leave()}
          className="h-9 cursor-pointer self-center rounded-sm px-4 text-sm font-bold text-[var(--reader-text-muted)] hover:text-[var(--reader-text)] shell:hidden"
        >
          Leave room
        </button>
      </div>
    </div>
  );
}

/** The iOS line shows for a reader's first room only (spec §1.7): marked
 * seen as soon as it shows, kept for the rest of that room. */
function useIosNote(): boolean {
  const [show] = useState(() => {
    try {
      return isIOSDevice() && !localStorage.getItem(IOS_NOTE_KEY);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      if (show) localStorage.setItem(IOS_NOTE_KEY, "1");
    } catch {}
  }, [show]);
  return show;
}
