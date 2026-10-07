import { NextResponse } from "next/server";
import { materialRoom } from "@/lib/room/server";

/**
 * `GET /api/materials/{materialId}/room` — the book's live room, if any, and
 * whether one can start here (reading-room-spec.md §11 surfacing). Public:
 * the Live chip shows to anyone; joining needs a session.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params;
  return NextResponse.json(await materialRoom(materialId));
}
