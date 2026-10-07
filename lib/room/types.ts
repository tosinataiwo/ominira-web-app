// Shapes shared by the room routes (server) and lib/room/api.ts (client).

import type { Avatar } from "@/lib/avatar/avatar";

export type RoomInfo = {
  id: string;
  materialId: string;
  /** Already resolved through roomTitle(), never null. */
  title: string;
  bookTitle: string;
  bookAuthor: string;
  startedBy: string;
  startedAt: string;
  maxMembers: number;
};

/** What room-start and room-join return (spec §7): everything a client
 * needs to enter the room. */
export type RoomJoinPayload = {
  room: RoomInfo;
  /** Display only; the server authorises moderator actions itself. */
  isModerator: boolean;
  /** The joining reader as others see them, from their `readers` row; it
   * goes into presence (events.ts). */
  me: { name: string; avatar: Avatar };
  /** Receivers honour `summon` only from these (reading-room-tasks.md log). */
  moderatorIds: string[];
  iceServers: RTCIceServer[];
  /** For the room's own Realtime client. The publishable key is public by design. */
  supabase: { url: string; key: string };
};

/** A book's room state, for the Live chip and "Start a room"
 * (GET /api/materials/{materialId}/room). */
export type MaterialRoom = {
  /** Public, published books only (start_room's rule). */
  canStart: boolean;
  live: { id: string; title: string; members: number; maxMembers: number } | null;
};

/** The ended screen (spec §3.4), for readers who joined the room
 * (GET /api/rooms/{roomId}/summary). */
export type RoomSummary = {
  title: string;
  bookTitle: string;
  startedAt: string;
  endedAt: string | null;
  /** Total time the room sat at its cap. */
  fullSeconds: number;
  moderatorNames: string[];
  joined: { total: number; first: { readerId: string; name: string; avatar: Avatar }[] };
};

/** One beacon per visit, with the leave (spec §8.10). */
export type RoomLeaveStats = {
  peakMics: number;
  peakPeers: number;
  iceRestarts: number;
  usedTurn: boolean;
};
