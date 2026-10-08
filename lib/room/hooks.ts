import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectBand, selectMargin } from "@/lib/room/margin";
import { selectHands, selectListening, selectSpeaking } from "@/lib/room/presence";
import type { RoomPresence } from "@/lib/room/events";
import type { RoomSnapshot } from "@/lib/room/session";
import { useRoomStore } from "@/stores/room-store";

// The UI's read side of the room (spec §8.1): selectors over the latest
// snapshot with shallow equality, so a component re-renders only when its
// slice changes (a speaking ring re-renders only that avatar). Null outside a room.

export function useRoom<T>(select: (snapshot: RoomSnapshot) => T): T | null {
  return useRoomStore(useShallow((s) => (s.snapshot ? select(s.snapshot) : null)));
}

export const useInRoom = () => useRoomStore((s) => s.snapshot !== null);

export const useRoster = () => useRoom((s) => s.roster);
/** Mic on, newest first: the panel's Speaking now. */
export const useSpeaking = () => useRoom((s) => selectSpeaking(s.roster));
export const useHands = () => useRoom((s) => selectHands(s.roster));
export const useListening = () => useRoom((s) => selectListening(s.roster));

/** Voices heard now, in Speaking now's order: the status line and the player's
 * face. A speaker reading aloud counts throughout, quiet gaps between
 * passages included. */
export const useVoices = () =>
  useRoom((s): RoomPresence[] =>
    selectSpeaking(s.roster).filter((p) => p.readingAloud !== null || s.speakingIds.includes(p.readerId))
  );

/** One member's audio state, for their avatar. */
export const useVoice = (readerId: string) =>
  useRoom((s) => ({
    speaking: s.speakingIds.includes(readerId),
    connecting: readerId in s.peerHealth && s.peerHealth[readerId] !== "connected",
  })) ?? { speaking: false, connecting: false };

/** Your own controls' state. "Reconnecting" only while the channel is down
 * and a wanted audio link is unhealthy too (spec §8.8). */
export const useRoomControls = () =>
  useRoom((s) => ({
    micOn: s.micOn,
    micState: s.micState,
    readingAloud: s.readingAloud,
    handRaised: s.handRaised,
    connection: s.connection,
    reconnecting: s.connection === "reconnecting" && Object.values(s.peerHealth).some((h) => h !== "connected"),
    audioSuspended: s.audioSuspended,
    isModerator: s.isModerator,
    elsewhere: s.elsewhere,
  }));

// ── Presence in the text (spec §9) ──────────────────────────────────────────

/** The open reader, when it's the room's book; null anywhere else. */
export const useReaderView = () =>
  useRoomStore((s) => (s.view && s.snapshot?.room.materialId === s.view.materialId ? s.view : null));

/** Who you follow, for the pill and the frame; null when nobody. */
export const useFollowing = () =>
  useRoom((s) => {
    const member = s.follow.targetId ? s.roster.find((p) => p.readerId === s.follow.targetId) : undefined;
    return member ? { member, paused: s.follow.paused, direction: s.follow.direction } : null;
  });

/** Tap-to-follow outside the room's own UI (spec §1.6): the rail's faces and
 * the notes feed's avatars. `tap(readerId)` is the follow toggle while you're
 * in the room on this book and they are too (never yourself), else null. */
export function useFollowTap() {
  const session = useRoomStore((s) => s.session);
  const onBook = useReaderView() !== null;
  const parts = useRoom((s) => ({ me: s.readerId, followingId: s.follow.targetId, roster: s.roster }));
  const live = session && onBook && parts ? { session, ...parts } : null;
  return {
    followingId: live?.followingId ?? null,
    tap: (readerId: string) =>
      live && readerId !== live.me && live.roster.some((p) => p.readerId === readerId)
        ? () => live.session.follow(readerId)
        : null,
  };
}

/** The quiet margin's readers and places. */
export function useMargin() {
  const parts = useRoom((s) => ({
    roster: s.roster,
    places: s.follow.places,
    readerId: s.readerId,
    followingId: s.follow.targetId,
  }));
  return useMemo(() => (parts ? selectMargin(parts.roster, parts.places, parts) : []), [parts]);
}

/** The speaker band: whose selection, and its ranges. */
export function useBand() {
  const parts = useRoom((s) => ({
    roster: s.roster,
    highlights: s.highlights,
    readerId: s.readerId,
    followingId: s.follow.targetId,
  }));
  return useMemo(
    () => (parts ? selectBand(parts.roster, parts.highlights, parts.readerId, parts.followingId) : null),
    [parts]
  );
}

/** A member's exact place (`pos`), when they send one. */
export const usePlace = (readerId: string) => useRoomStore((s) => s.snapshot?.follow.places[readerId]);
