import { getAuthenticatedReader } from "@/lib/auth/session";
import { forbidden, notFound, unauthorized } from "@/lib/api/errors";
import { UUID_RE } from "@/lib/materials/resolve";
import { endRoom } from "@/lib/room/server";

/**
 * `POST /api/rooms/{roomId}/end` — End room (reading-room-spec.md §7, §12),
 * moderators only. end_room broadcasts `ended` to the channel from the
 * server. Ending an already-ended room is a no-op success.
 */
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const reader = await getAuthenticatedReader(request);
  if (!reader) return unauthorized();

  const { roomId } = await params;
  if (!UUID_RE.test(roomId)) return notFound("No room found.");
  if (!(await endRoom(reader.readerId, roomId))) return forbidden("Only a moderator can end the room.");
  return new Response(null, { status: 204 });
}
