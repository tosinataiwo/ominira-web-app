import { getAuthenticatedReader } from "@/lib/auth/session";
import { notFound, unauthorized, validationError } from "@/lib/api/errors";
import { UUID_RE } from "@/lib/materials/resolve";
import { joinResponse, joinRoom, startRoom } from "@/lib/room/server";

/**
 * `POST /api/rooms` — room-start (reading-room-spec.md §7). Any signed-in
 * reader may start a room on a public book (interim host,
 * reading-room-tasks.md); if that book already has a live room, this joins
 * it instead. Returns the room-join payload either way.
 */
export async function POST(request: Request) {
  const reader = await getAuthenticatedReader(request);
  if (!reader) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { materialId?: unknown; title?: unknown };
  if (typeof body.materialId !== "string" || !UUID_RE.test(body.materialId)) {
    return validationError("materialId is required.", "materialId");
  }
  if (body.title != null && typeof body.title !== "string") return validationError("title must be text.", "title");

  const roomId = await startRoom(reader.readerId, body.materialId, (body.title as string | undefined) ?? null);
  if (!roomId) return notFound("Rooms can only be started on public books.");
  return joinResponse(await joinRoom(reader.readerId, roomId));
}
