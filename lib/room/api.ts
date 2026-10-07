import { apiFetch } from "@/lib/api/client";
import type { RoomJoinPayload, RoomLeaveStats, RoomSummary } from "@/lib/room/types";
import { useSessionStore } from "@/stores/session-store";

// Client side of the room lifecycle routes (spec §8.1). Refusals arrive as
// ApiError with code `room_full` / `room_ended` / `forbidden` / `not_found`.

export function startRoom(materialId: string, title?: string): Promise<RoomJoinPayload> {
  return apiFetch("/rooms", { json: { materialId, title } });
}

export function joinRoom(roomId: string): Promise<RoomJoinPayload> {
  return apiFetch(`/rooms/${roomId}/join`, { method: "POST" });
}

export function leaveRoom(roomId: string, stats?: RoomLeaveStats): Promise<void> {
  return apiFetch(`/rooms/${roomId}/leave`, stats ? { json: stats } : { method: "POST" });
}

/** The `pagehide` leave: synchronous to start (no token refresh), and
 * `keepalive` so it outlives the page. Uses whatever token is in hand; if it
 * has expired, the heartbeat ageing out covers it. */
export function leaveRoomOnUnload(roomId: string, stats: RoomLeaveStats): void {
  const token = useSessionStore.getState().session?.accessToken;
  if (!token) return;
  void fetch(`/api/rooms/${roomId}/leave`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(stats),
    keepalive: true,
  }).catch(() => {});
}

export function endRoom(roomId: string): Promise<void> {
  return apiFetch(`/rooms/${roomId}/end`, { method: "POST" });
}

export function getRoomSummary(roomId: string): Promise<RoomSummary> {
  return apiFetch(`/rooms/${roomId}/summary`);
}
