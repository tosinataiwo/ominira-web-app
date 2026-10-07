import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectBand, selectMargin, selectReadingCount } from "@/lib/room/margin";
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

/** Voices heard now, in Speaking now's order: the status line and the player's face. */
export const useVoices = () =>
  useRoom((s): RoomPresence[] => selectSpeaking(s.roster).filter((p) => s.speakingIds.includes(p.readerId)));

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

/** A moderator's Bring everyone to my page, for the Jump prompt. */
export const useSummon = () =>
  useRoom((s) => {
    const member = s.follow.summon && s.roster.find((p) => p.readerId === s.follow.summon!.from);
    return member ? { member } : null;
  });

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

/** "N reading" (spec §1.3). */
export const useReadingCount = () =>
  useRoom((s) =>
    selectReadingCount(
      s.roster,
      s.readerId,
      selectMargin(s.roster, s.follow.places, { readerId: s.readerId, followingId: s.follow.targetId }).map(
        (m) => m.member.readerId,
      ),
    ),
  ) ?? 0;

/** The speaker band: whose selection, and its ranges. */
export function useBand() {
  const parts = useRoom((s) => ({ roster: s.roster, highlights: s.highlights, readerId: s.readerId }));
  return useMemo(() => (parts ? selectBand(parts.roster, parts.highlights, parts.readerId) : null), [parts]);
}

/** A member's exact place (`pos`), when they send one. */
export const usePlace = (readerId: string) => useRoomStore((s) => s.snapshot?.follow.places[readerId]);
