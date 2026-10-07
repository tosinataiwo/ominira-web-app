import { getAuthenticatedReader } from "@/lib/auth/session";
import { notFound, unauthorized } from "@/lib/api/errors";
import { UUID_RE } from "@/lib/materials/resolve";
import { joinResponse, joinRoom } from "@/lib/room/server";

/**
 * `POST /api/rooms/{roomId}/join` — room-join (reading-room-spec.md §7):
 * access, the 25 cap (409 `room_full`), membership upsert, then the room
 * config, moderator ids and short-lived ICE servers.
 */
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const reader = await getAuthenticatedReader(request);
  if (!reader) return unauthorized();

  const { roomId } = await params;
  if (!UUID_RE.test(roomId)) return notFound("No room found.");
  return joinResponse(await joinRoom(reader.readerId, roomId));
}
