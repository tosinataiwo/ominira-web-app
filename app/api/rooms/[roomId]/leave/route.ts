import { z } from "zod";
import { getAuthenticatedReader } from "@/lib/auth/session";
import { notFound, unauthorized } from "@/lib/api/errors";
import { UUID_RE } from "@/lib/materials/resolve";
import { leaveRoom } from "@/lib/room/server";

// The visit's one stats beacon rides on the leave (spec §8.10): logged, not stored.
const LeaveStats = z.object({
  peakMics: z.int().nonnegative().max(100),
  peakPeers: z.int().nonnegative().max(100),
  iceRestarts: z.int().nonnegative().max(10_000),
  usedTurn: z.boolean(),
});

/**
 * `POST /api/rooms/{roomId}/leave` — room-leave (reading-room-spec.md §7).
 * Idempotent. Also the `pagehide` path: the client sends it with
 * `fetch(..., { keepalive: true })`, which outlives the page like sendBeacon
 * but keeps the Authorization header. Crashes are covered by the heartbeat
 * ageing out and the sweep. An optional JSON body carries the visit's audio
 * stats.
 */
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const reader = await getAuthenticatedReader(request);
  if (!reader) return unauthorized();

  const { roomId } = await params;
  if (!UUID_RE.test(roomId)) return notFound("No room found.");
  await leaveRoom(reader.readerId, roomId);
  const stats = LeaveStats.safeParse(await request.json().catch(() => null));
  if (stats.success) console.info("[room] leave", JSON.stringify({ roomId, ...stats.data }));
  return new Response(null, { status: 204 });
}
