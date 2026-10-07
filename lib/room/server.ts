import "server-only";

import { NextResponse } from "next/server";
import { apiError, forbidden, notFound } from "@/lib/api/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import { toAvatar } from "@/lib/avatar/avatar";
import { getIceServers } from "@/lib/room/turn";
import { roomTitle } from "@/lib/room/title";
import { resolveMaterialRow } from "@/lib/materials/resolve";
import type { MaterialRoom, RoomJoinPayload, RoomSummary } from "@/lib/room/types";

// Room lifecycle for the thin app/api/rooms/* routes (spec §0 rule 5, §7).
// The rules themselves (access, cap, full clock) live in the SQL functions;
// this module calls them and shapes the response.

export type JoinRefusal = "not_found" | "ended" | "forbidden" | "full";

/** Starts a room on a public book, or returns the one already live on it.
 * Null when the book can't host a room. */
export async function startRoom(readerId: string, materialId: string, title: string | null): Promise<string | null> {
  const { data, error } = await getSupabaseAdminClient().rpc("start_room", {
    material: materialId,
    reader: readerId,
    room_title: title,
  });
  if (error) throw error;
  return data;
}

export async function joinRoom(
  readerId: string,
  roomId: string,
): Promise<{ payload: RoomJoinPayload } | { refused: JoinRefusal }> {
  const admin = getSupabaseAdminClient();
  const { data: outcome, error } = await admin.rpc("join_room", { room: roomId, reader: readerId });
  if (error) throw error;
  if (outcome !== "joined") return { refused: outcome };

  // ICE credentials are the slow call (Cloudflare), so it runs alongside the reads.
  const [roomRes, modsRes, meRes, iceServers] = await Promise.all([
    admin.from("rooms").select("id, material_id, title, started_by, started_at, max_members").eq("id", roomId).single(),
    admin.rpc("room_moderator_ids", { room: roomId }),
    admin.from("readers").select("pseudonym, avatar_color, avatar_url").eq("id", readerId).single(),
    getIceServers(),
  ]);
  if (roomRes.error) throw roomRes.error;
  if (modsRes.error) throw modsRes.error;
  if (meRes.error) throw meRes.error;
  const room = roomRes.data;

  const { data: book, error: bookError } = await admin
    .from("materials")
    .select("title, author")
    .eq("id", room.material_id)
    .single();
  if (bookError) throw bookError;

  const moderatorIds = modsRes.data;
  return {
    payload: {
      room: {
        id: room.id,
        materialId: room.material_id,
        title: roomTitle(room.title, book.title),
        bookTitle: book.title,
        bookAuthor: book.author,
        startedBy: room.started_by,
        startedAt: room.started_at,
        maxMembers: room.max_members,
      },
      isModerator: moderatorIds.includes(readerId),
      me: { name: meRes.data.pseudonym, avatar: toAvatar(meRes.data) },
      moderatorIds,
      iceServers,
      supabase: { url: process.env.SUPABASE_URL!, key: process.env.SUPABASE_PUBLISHABLE_KEY! },
    },
  };
}

/** Idempotent; frees the reader's place at once. */
export async function leaveRoom(readerId: string, roomId: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("leave_room", { room: roomId, reader: readerId });
  if (error) throw error;
}

/** Moderators only. False when the reader isn't one; true once the room is
 * ended (by this call or an earlier one), and everyone is told by end_room. */
export async function endRoom(readerId: string, roomId: string): Promise<boolean> {
  const admin = getSupabaseAdminClient();
  const { data: isModerator, error } = await admin.rpc("is_room_moderator", { room: roomId, reader: readerId });
  if (error) throw error;
  if (!isModerator) return false;
  const { error: endError } = await admin.rpc("end_room", { room: roomId });
  if (endError) throw endError;
  return true;
}

/** The one response for a join attempt, shared by room-start and room-join. */
export function joinResponse(result: Awaited<ReturnType<typeof joinRoom>>) {
  if ("payload" in result) return NextResponse.json(result.payload);
  switch (result.refused) {
    case "not_found":
      return notFound("No room found.");
    case "forbidden":
      return forbidden("You can't join this room.");
    case "full":
      return apiError("room_full", "This room is full.");
    case "ended":
      return apiError("room_ended", "This room has ended.");
  }
}

/** Whether a room can start on this book, and the one live on it, if any. */
export async function materialRoom(materialId: string): Promise<MaterialRoom> {
  const material = await resolveMaterialRow(materialId);
  if (!material || material.visibility !== "public") return { canStart: false, live: null };

  const admin = getSupabaseAdminClient();
  const { data: room, error } = await admin
    .from("rooms")
    .select("id, title, max_members")
    .eq("material_id", material.id)
    .eq("status", "live")
    .is("group_id", null)
    .maybeSingle();
  if (error) throw error;
  if (!room) return { canStart: true, live: null };

  const { data: members, error: countError } = await admin.rpc("room_active_count", { room: room.id });
  if (countError) throw countError;
  return {
    canStart: true,
    live: { id: room.id, title: roomTitle(room.title, material.title), members, maxMembers: room.max_members },
  };
}

/** Faces shown on the ended screen before "+N". */
const SUMMARY_FACES = 9;

/** The ended screen's data. Null unless the reader joined the room. */
export async function roomSummary(readerId: string, roomId: string): Promise<RoomSummary | null> {
  const admin = getSupabaseAdminClient();
  const { data: member } = await admin
    .from("room_members")
    .select("reader_id")
    .eq("room_id", roomId)
    .eq("reader_id", readerId)
    .maybeSingle();
  if (!member) return null;

  const [roomRes, joinedRes, modsRes] = await Promise.all([
    admin.from("rooms").select("material_id, title, started_at, ended_at, full_seconds").eq("id", roomId).single(),
    admin
      .from("room_members")
      .select("reader_id", { count: "exact" })
      .eq("room_id", roomId)
      .order("joined_at")
      .limit(SUMMARY_FACES),
    admin.rpc("room_moderator_ids", { room: roomId }),
  ]);
  if (roomRes.error) throw roomRes.error;
  if (joinedRes.error) throw joinedRes.error;
  if (modsRes.error) throw modsRes.error;
  const room = roomRes.data;
  const firstIds = joinedRes.data.map((m) => m.reader_id);

  const [bookRes, readersRes] = await Promise.all([
    admin.from("materials").select("title").eq("id", room.material_id).single(),
    admin
      .from("readers")
      .select("id, pseudonym, avatar_color, avatar_url")
      .in("id", [...new Set([...firstIds, ...modsRes.data])]),
  ]);
  if (bookRes.error) throw bookRes.error;
  if (readersRes.error) throw readersRes.error;
  const byId = new Map(readersRes.data.map((r) => [r.id, r]));

  return {
    title: roomTitle(room.title, bookRes.data.title),
    bookTitle: bookRes.data.title,
    startedAt: room.started_at,
    endedAt: room.ended_at,
    fullSeconds: room.full_seconds,
    moderatorNames: modsRes.data.flatMap((id) => byId.get(id)?.pseudonym ?? []),
    joined: {
      total: joinedRes.count ?? firstIds.length,
      first: firstIds.flatMap((id) => {
        const r = byId.get(id);
        return r ? [{ readerId: id, name: r.pseudonym, avatar: toAvatar(r) }] : [];
      }),
    },
  };
}
