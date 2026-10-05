import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import { getAuthenticatedReader } from "@/lib/auth/session";
import { forbidden, notFound, unauthorized, validationError } from "@/lib/api/errors";
import { contentToColumns, hydrateNotes, type NoteRow, type PostKind } from "@/lib/community/notes";
import { enrichFeedItems } from "@/lib/community/feed";
import { STORAGE_BUCKET, objectPathFromPublicUrl } from "@/lib/storage/config";
import type { NoteContent } from "@/lib/api/types";
import { invalidateMaterialStorage } from "@/lib/materials/storageCache";
import type { Database } from "@/lib/supabase/database.types";

/** One thread, in the same `FeedItem` shape the home feed ships — so
 * /post/[id] renders through the very same NoteCard the feed does, with no
 * second enrichment path to keep in sync (this route used to hand-roll its
 * own, minus the excerpt, which is exactly the drift enrichFeedItems exists
 * to prevent).
 *
 * Asking for a *reply* returns its root thread with `focusId` set to that
 * reply: a reply has no standalone page of its own — it's only ever read in
 * its thread — and that's what a reply notification links to.
 */
export async function GET(request: Request, { params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  const reader = await getAuthenticatedReader(request);
  const admin = getSupabaseAdminClient();

  const { data: row } = await admin.from("posts").select("*").eq("id", noteId).maybeSingle();
  // Same rule as the per-material feed: a private note is only visible to its
  // own author — 404, not 403, so existence of a private note is never leaked.
  if (!row || (row.visibility !== "public" && row.reader_id !== reader?.readerId)) return notFound();

  let rootRow = row as NoteRow;
  if (row.parent_id) {
    const { data: parent } = await admin.from("posts").select("*").eq("id", row.parent_id).maybeSingle();
    if (!parent || (parent.visibility !== "public" && parent.reader_id !== reader?.readerId)) return notFound();
    rootRow = parent as NoteRow;
  }

  const [item] = await enrichFeedItems([rootRow], reader?.readerId);
  if (!item) return notFound();

  return NextResponse.json({ ...item, focusId: row.parent_id ? row.id : null });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ noteId: string }> }) {
  const reader = await getAuthenticatedReader(request);
  if (!reader) return unauthorized();

  const { noteId } = await params;
  const admin = getSupabaseAdminClient();
  const { data: existing } = await admin.from("posts").select("reader_id, kind").eq("id", noteId).maybeSingle();
  if (!existing) return notFound();
  if (existing.reader_id !== reader.readerId) return forbidden();

  const body = (await request.json()) as { content?: NoteContent; visibility?: "public" | "private" };
  const update: Database["public"]["Tables"]["posts"]["Update"] = {};
  // Preserves whatever this row's own kind already was (citation/text/
  // book_share) rather than defaulting back to contentToColumns' own
  // 'citation' default — a book-less discussion post edited here would
  // otherwise get reset to kind='citation' with material_id still null,
  // which the posts_citation_requires_material check constraint rejects.
  if (body.content) Object.assign(update, contentToColumns(body.content, existing.kind as PostKind));
  if (body.visibility) update.visibility = body.visibility;

  const { data, error } = await admin.from("posts").update(update).eq("id", noteId).select("*").single();
  if (error || !data) return validationError("Could not update note.");

  const [note] = await hydrateNotes([data], reader.readerId);
  return NextResponse.json(note);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ noteId: string }> }) {
  const reader = await getAuthenticatedReader(request);
  if (!reader) return unauthorized();

  const { noteId } = await params;
  const admin = getSupabaseAdminClient();
  const { data: existing } = await admin.from("posts").select("reader_id, material_id").eq("id", noteId).maybeSingle();
  if (!existing) return notFound();
  if (existing.reader_id !== reader.readerId) return forbidden();

  // parent_id on delete cascade (models-spec.md) takes the whole reply
  // subtree with it — no manual descendant collection needed here, unlike
  // the client store's own collectWithDescendants (which existed only
  // because there was no DB to cascade for it).
  const { error } = await admin.from("posts").delete().eq("id", noteId);
  if (error) return notFound();

  // posts.material_id is `on delete set null`, so the row above never took
  // the material with it — a personal upload (reader-uploads-spec.md) that
  // was only ever attached to this one post would otherwise sit orphaned in
  // `materials` forever. Only clean it up when it's this reader's own
  // personal upload and no other post still points at it; a catalog book or
  // a material shared by another post is left untouched.
  if (existing.material_id) {
    const { data: material } = await admin
      .from("materials")
      .select("id, slug, uploaded_by, source_url, json_storage_path, cover_url")
      .eq("id", existing.material_id)
      .maybeSingle();
    if (material && material.uploaded_by === reader.readerId) {
      const { count } = await admin
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("material_id", material.id);
      if (!count) {
        await admin.from("pending_materials").delete().eq("material_id", material.id);
        const { error: materialDeleteError } = await admin.from("materials").delete().eq("id", material.id);
        if (!materialDeleteError) {
          invalidateMaterialStorage(material.slug);
          const objectPaths = [material.source_url, material.json_storage_path, material.cover_url]
            .filter((url): url is string => !!url)
            .map((url) => objectPathFromPublicUrl(STORAGE_BUCKET, url))
            .filter((path): path is string => !!path);
          if (objectPaths.length > 0) await admin.storage.from(STORAGE_BUCKET).remove(objectPaths);
        }
      }
    }
  }

  return new Response(null, { status: 204 });
}
