import { create } from "zustand";
import { ApiError, ensureFreshSession } from "@/lib/api/client";
import type { AnnotationRange } from "@/lib/api/types";
import { setAudioSessionType } from "@/lib/room/audioSession"; // REVERT: remove with the call in enter()
import type { RoomSession, RoomSnapshot } from "@/lib/room/session";
import type { PendingPassage } from "@/lib/room/sharePassage";
import type { ReaderView } from "@/lib/room/view";
import { useSessionStore } from "@/stores/session-store";

/**
 * The live room, in the app shell so it survives navigation (the
 * mini-player outlives the reader), same footing as audio-store. Holds the
 * session's latest snapshot; components read it through lib/room/hooks.ts
 * and call `session`'s methods, never the channel.
 *
 * The room code is loaded here, on first start or join (spec §0.7), and
 * nowhere else. One session per room visit: entering another room leaves
 * this one first.
 *
 * It also holds the open reader (`view`, from useRoomView) and its
 * selection, in or out of a room, and hands them to the session, which is
 * how following and the speaker band reach the text.
 */
type RoomState = {
  snapshot: RoomSnapshot | null;
  session: RoomSession | null;
  view: ReaderView | null;
  selection: readonly AnnotationRange[] | null;
  setView: (view: ReaderView | null) => void;
  setSelection: (ranges: readonly AnnotationRange[] | null) => void;
  /** A passage shared from the reader, waiting in the chat composer (sharePassage.ts). */
  passage: PendingPassage | null;
  attachPassage: (passage: PendingPassage) => void;
  clearPassage: () => void;
  /** Starts a room on the book, or joins the one already live on it. */
  start: (materialId: string, title?: string) => Promise<void>;
  join: (roomId: string) => Promise<void>;
  /** Also dismisses the ended screen and the "open in another tab" state. */
  leave: () => Promise<void>;
  /** After a reload: back into the room this tab was in, unless it was left. */
  resume: () => Promise<void>;
};

/** The room this tab is in, per tab (sessionStorage), so a reload goes back
 * in and a new tab doesn't take the room from this one (spec §8.2). Cleared
 * by leaving, the room ending, or yielding to another tab. */
const RESUME_KEY = "ominira-room";

/** Kept with the reader, so another account signing in here isn't put in. */
function remember(roomId: string | null) {
  try {
    const readerId = useSessionStore.getState().readerId;
    if (roomId && readerId) sessionStorage.setItem(RESUME_KEY, JSON.stringify({ readerId, roomId }));
    else sessionStorage.removeItem(RESUME_KEY);
  } catch {}
}

function remembered(): string | null {
  try {
    const held = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? "null") as { readerId: string; roomId: string } | null;
    return held && held.readerId === useSessionStore.getState().readerId ? held.roomId : null;
  } catch {
    return null;
  }
}

/** The room this tab is taking part in: not ended, not yielded to another tab. */
export const activeRoom = (s: { snapshot: RoomSnapshot | null }) =>
  s.snapshot && !s.snapshot.ended && !s.snapshot.elsewhere ? s.snapshot : null;

/** Unread room chat when you're in the room on this book, else null: the
 * feed panel's Room tab and the rail's room button (spec §1.4). */
export const roomChatUnread = (s: { snapshot: RoomSnapshot | null }, materialId: string) => {
  const room = activeRoom(s);
  return room?.room.materialId === materialId ? room.chat.unread : null;
};

export const useRoomStore = create<RoomState>()((set, get) => {
  async function enter(isCurrent: (s: RoomSnapshot) => boolean, go: (session: RoomSession) => Promise<void>) {
    const current = activeRoom(get());
    if (current && isCurrent(current)) return;
    const readerId = useSessionStore.getState().readerId;
    if (!readerId) throw new Error("Sign in to join a room.");
    // Still inside the tap: the only moment browsers let a page start sound
    // (spec §8.6). Everything after this awaits.
    setAudioSessionType("playback"); // REVERT: remove this line (iOS audio session, lib/room/audioSession.ts)
    const audio = new AudioContext();
    void audio.resume();
    await get().leave();

    const { RoomSession } = await import("@/lib/room/session").catch((err) => {
      void audio.close();
      throw err;
    });
    const session = new RoomSession(readerId, async () => (await ensureFreshSession()) ?? null, audio);
    session.setView(get().view);
    session.setSelection(get().selection);
    set({ session });
    // A session that has been left can't write over the next one.
    session.subscribe((snapshot) => {
      if (get().session !== session) return;
      set({ snapshot });
      if (snapshot) remember(activeRoom({ snapshot })?.room.id ?? null);
    });
    try {
      await go(session);
    } catch (err) {
      if (get().session === session) set({ session: null, snapshot: null });
      void audio.close().catch(() => {});
      throw err;
    }
  }

  return {
    snapshot: null,
    session: null,
    view: null,
    selection: null,
    setView: (view) => {
      set({ view });
      get().session?.setView(view);
    },
    setSelection: (selection) => {
      set({ selection });
      get().session?.setSelection(selection);
    },
    passage: null,
    attachPassage: (passage) => set({ passage }),
    clearPassage: () => set({ passage: null }),
    start: (materialId, title) =>
      enter((s) => s.room.materialId === materialId, (session) => session.start(materialId, title)),
    join: (roomId) => enter((s) => s.room.id === roomId, (session) => session.join(roomId)),
    leave: async () => {
      const session = get().session;
      if (session) remember(null);
      set({ session: null, snapshot: null, passage: null });
      await session?.leave();
    },
    resume: async () => {
      const roomId = remembered();
      if (!roomId || get().session) return;
      await get()
        .join(roomId)
        .catch((err) => {
          // Ended, full or gone meanwhile: stay out, as after leaving. A
          // network or auth blip keeps it for the next reload.
          if (err instanceof ApiError && err.status !== 401 && err.status < 500) remember(null);
        });
    },
  };
});
