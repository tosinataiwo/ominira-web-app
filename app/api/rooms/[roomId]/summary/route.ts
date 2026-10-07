import { NextResponse } from "next/server";
import { getAuthenticatedReader } from "@/lib/auth/session";
import { notFound, unauthorized } from "@/lib/api/errors";
import { UUID_RE } from "@/lib/materials/resolve";
import { roomSummary } from "@/lib/room/server";

/**
 * `GET /api/rooms/{roomId}/summary` — the ended screen (reading-room-spec.md
 * §3.4): who joined, how long it ran, how long it was full. Only for readers
 * who joined the room.
 */
export async function GET(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const reader = await getAuthenticatedReader(request);
  if (!reader) return unauthorized();

  const { roomId } = await params;
  if (!UUID_RE.test(roomId)) return notFound("No room found.");
  const summary = await roomSummary(reader.readerId, roomId);
  return summary ? NextResponse.json(summary) : notFound("No room found.");
}
