"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import FollowPill from "./FollowPill";
import { RisingReactions } from "./Reactions";
import RoomActions, { ROOM_CHAT_ID } from "./RoomActions";
import RoomAvatar from "./RoomAvatar";
import { useBottomDock, useNarrationBarHeight } from "@/app/components/useBottomDock";
import { isIOSDevice } from "@/lib/pwa/platform";
import { useFollowing, useReaderView, useRoom, useRoomControls, useVoices } from "@/lib/room/hooks";
import { micBlockedHelp } from "@/lib/room/mic";
import { speakingLine } from "@/lib/room/presence";
import { useDebounced } from "@/lib/time/useDebounced";
import { useFeedStore } from "@/stores/feed-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useOpenRoom } from "@/lib/room/useOpenRoom";
import { useRoomStore } from "@/stores/room-store";
import { showToast } from "@/stores/toast-store";

// The room's mini-player (spec §1.2): a card floating in the middle, clear
// of everything docked below it — the narration bar and, in the reader, the
// chapter footer, sliding down when the footer tucks away (on phones,
// contents stacked, C1; from the shell breakpoint, one row at max 840px, C2). In the
// app shell, so it survives leaving the reader. Expanding it opens the
// book's feed panel on its Room tab (back in the book, when you've left
// it); it stays up while that panel is open, holding the controls, so the
// panel's Room tab is just who's here and the chat. Its status line carries
// the states of spec §10. In the book's reader, the follow pill floats just
// above it. Leave room, and End room for a moderator, sit in RoomExit.

// Your mic, hand, reactions and the way into the chat are RoomActions.
const useHereButton =
  "flex h-11 items-center justify-center gap-2 rounded-sm border px-3.5 text-[14px] font-bold whitespace-nowrap cursor-pointer transition-colors shell:h-10 shell:flex-none";

const IOS_NOTE_KEY = "ominira-room-ios-note";

/** Expanded, the chat is already in the panel: scroll just the panel's list
 * to it. scrollIntoView would scroll the page too, lifting the panel's
 * header out of view. */
function scrollToChat() {
  const chat = document.getElementById(ROOM_CHAT_ID);
  const list = chat?.closest(".om-scroll");
  if (!chat || !list) return;
  const top = chat.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  list.scrollTo({ top: top - 16, behavior: "smooth" });
}

export default function RoomMiniPlayer() {
  const dock = useBottomDock();
  const narrationHeight = useNarrationBarHeight();
  const footerHeight = useLayoutStore((s) => s.readerFooterHeight);
  const below = dock.bottom + narrationHeight + footerHeight;
  const setRoomPlayerHeight = useLayoutStore((s) => s.setRoomPlayerHeight);
  const openRoom = useOpenRoom();
  const materialId = useRoom((s) => s.room.materialId);
  const join = useRoomStore((s) => s.join);
  const session = useRoomStore((s) => s.session);
  const controls = useRoomControls();
  const voices = useVoices();
  const title = useRoom((s) => s.room.title);
  const roomId = useRoom((s) => s.room.id);
  // Who the player shows: you, until someone is heard — then them.
  const featured = useRoom((s) => voices?.[0] ?? s.roster.find((p) => p.readerId === s.readerId));
  const me = useRoom((s) => s.readerId);
  const followingId = useFollowing()?.member.readerId;
  const inReader = useReaderView() !== null;
  const iosNote = useIosNote();
  // Already expanded: the book's panel is open on its Room tab.
  const expanded = useFeedStore((s) => inReader && s.openFor === materialId && s.tab === "room");
  // On phones the feed panel is a sheet the player would cover, so the
  // player steps aside while it's open on this book.
  const feedOpen = useFeedStore((s) => inReader && s.openFor === materialId);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The border box: its bottom padding is the gap below the card, which
    // whatever stacks above clears too.
    const ro = new ResizeObserver((entries) => setRoomPlayerHeight(entries[0].borderBoxSize[0].blockSize));
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
  const { elsewhere, audioSuspended } = controls;
  const blocked = status === "Mic blocked";

  return (
    <div
      ref={ref}
      data-reader-theme={dock.theme}
      className={`${dock.className} pointer-events-none ${feedOpen ? "hidden shell:flex" : "flex"} flex-col px-3 pb-3 transition-[bottom] duration-200 ease-out shell:items-center shell:px-6 shell:pb-4`}
      // At the screen's edge, it clears the home indicator too.
      style={{ bottom: below, marginBottom: below === 0 ? "env(safe-area-inset-bottom)" : undefined }}
    >
      {inReader && !elsewhere && (
        <div className="pointer-events-none absolute inset-x-0 bottom-full flex flex-wrap justify-center gap-2 px-3 pb-2 empty:hidden">
          <FollowPill />
        </div>
      )}
      <div className="pointer-events-auto relative flex flex-col gap-3 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] px-3.5 pt-3.5 pb-1.5 shadow-md shell:w-full shell:max-w-[840px] shell:flex-row shell:flex-wrap shell:items-center shell:gap-x-4 shell:gap-y-2 shell:py-3 shell:pr-13 shell:pl-3.5">
        {!elsewhere && <RisingReactions />}
        {!elsewhere && !expanded && (
          <button
            type="button"
            onClick={() => openRoom(materialId!)}
            aria-label="Open the room"
            title="Open the room"
            className="absolute top-2.5 right-2.5 flex h-9 w-9 cursor-pointer items-center justify-center rounded-sm text-[var(--reader-text-muted)] hover:bg-[var(--reader-surface-hover)] hover:text-[var(--reader-text)] shell:top-1.5 shell:right-1.5 shell:h-8 shell:w-8"
          >
            <Maximize2 size={18} strokeWidth={1.75} />
          </button>
        )}

        <div className={`flex min-w-0 items-center gap-3 shell:flex-1 shell:pr-0 ${expanded ? "" : "pr-10"}`}>
          {featured && (
            <RoomAvatar
              member={featured}
              size={40}
              pressed={featured.readerId === followingId}
              onClick={featured.readerId !== me && !elsewhere ? () => session.follow(featured.readerId) : undefined}
            />
          )}
          <div className="flex min-w-0 flex-col items-start gap-0.5">
            <span className="max-w-full truncate text-[14px] font-bold text-[var(--reader-text)]">{title}</span>
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
            <RoomExit className="-ml-1.5 hidden shell:flex" button="h-6.5 px-1.5 text-xs" />
          </div>
        </div>

        {elsewhere ? (
          // Joining again here makes the other tab yield instead.
          <button
            type="button"
            onClick={() =>
              void join(roomId!).catch((err) => showToast(err instanceof Error ? err.message : "Couldn't join the room."))
            }
            className={`${useHereButton} border-[var(--reader-accent)] bg-transparent text-[var(--reader-accent)]`}
          >
            Use here
          </button>
        ) : (
          <RoomActions
            onChat={() => (expanded ? scrollToChat() : openRoom(materialId!))}
          />
        )}

        {iosNote && !elsewhere && (
          <p className="text-xs text-[var(--reader-text-muted)] shell:basis-full">
            Keep Ominira open to keep listening. Audio stops when your screen locks.
          </p>
        )}

        <RoomExit className="justify-center gap-2 shell:hidden" button="h-9 px-4 text-sm" />
      </div>
    </div>
  );
}

/** Leave room, and for a moderator End room (asked first: it ends the room
 * for everyone). `button` sizes both for where they sit. */
function RoomExit({ className, button }: { className: string; button: string }) {
  const leave = useRoomStore((s) => s.leave);
  const session = useRoomStore((s) => s.session);
  const isModerator = useRoomControls()?.isModerator ?? false;
  const [ending, setEnding] = useState(false);
  const base = `${button} cursor-pointer rounded-sm font-bold whitespace-nowrap disabled:cursor-default disabled:opacity-50`;
  return (
    <div className={`flex items-center ${className}`}>
      <button
        type="button"
        onClick={() => void leave()}
        className={`${base} text-[var(--reader-text-muted)] hover:text-[var(--reader-text)]`}
      >
        Leave room
      </button>
      {isModerator && session && (
        <button
          type="button"
          disabled={ending}
          onClick={() => {
            if (!window.confirm("End the room for everyone?")) return;
            setEnding(true);
            session.end().catch(() => {
              setEnding(false);
              showToast("Couldn't end the room. Try again.");
            });
          }}
          className={`${base} text-red-600 hover:text-red-700`}
        >
          {ending ? "Ending…" : "End room"}
        </button>
      )}
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
