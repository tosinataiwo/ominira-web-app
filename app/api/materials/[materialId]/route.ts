import { NextResponse } from "next/server";
import { forbidden, notFound, unauthorized, validationError } from "@/lib/api/errors";
import { getAuthenticatedReader } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import { resolveMaterialRow } from "@/lib/materials/resolve";
import { MaterialSectionNotFoundError, projectMaterial } from "@/lib/materials/projection";
import { STORAGE_BUCKET, objectPathFromPublicUrl } from "@/lib/storage/config";
import { MAX_UPLOAD_IMAGES, uploadImagesFolder } from "@/lib/materials/uploadPaths";
import { invalidateMaterialStorage } from "@/lib/materials/storageCache";

const CONTENT_FIELDS = new Set(["sections", "narrators", "notes"]);
const CONTENT_CACHE = "public, max-age=31536000, immutable";
const METADATA_CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

export async function GET(request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params;
  const row = await resolveMaterialRow(materialId);
  if (!row) return notFound();

  const url = new URL(request.url);
  const fieldsParam = url.searchParams.get("fields");
  const fields = fieldsParam
    ? fieldsParam
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];
  const sectionId = url.searchParams.get("sectionId") ?? undefined;
  const passagesOnly = url.searchParams.get("passagesOnly") === "true";
  const fullContent = url.searchParams.get("fullContent") === "true";

  try {
    const projected = await projectMaterial(row, { fields, sectionId, passagesOnly, fullContent });
    // Every reader open fetches the whole book's text through here
    // (useProgressiveText's background wave) — uncached, that's multi-MB of
    // uncompressed JSON per open billed as Vercel Fast Origin Transfer, the
    // Hobby limit that kept pausing deployments. Book content never changes
    // once published, and the URL is keyed by the material's own id (never
    // reused, unlike a slug), so the browser and Vercel's CDN keep it for a
    // year; DB-only
    // fields (title, author, …) are editable, so those get a short window.
    const isContent = fullContent || sectionId !== undefined || fields.some((f) => CONTENT_FIELDS.has(f));
    return NextResponse.json(projected, {
      headers: { "Cache-Control": isContent ? CONTENT_CACHE : METADATA_CACHE },
    });
  } catch (err) {
    if (err instanceof MaterialSectionNotFoundError) return notFound();
    throw err;
  }
}

/**
 * A reader editing their own upload's title/author/visibility/categories —
 * the same "reader can always fix a bad auto-detected guess" affordance the
 * attachment preview in HomeComposer/AddBookModal exposes inline
 * (lib/materials/useUploadBook.ts's `onMetadata` guess is only ever a
 * starting point, not the final word). `visibility` and `categories` cover
 * the composer's per-book Private/Share-with-everyone pill and category tags
 * (library-contribution-ux-spec.md Step 4) — `visibility` is the same field
 * useUploadBook's initial upload POST sets; `categories` has no equivalent
 * there (the upload route never touches it), so this route is the only place
 * a reader upload's categories get set. Both are editable through this same
 * queue-until-materialId-exists path (lib/materials/
 * useAttachmentMetadataEditor.ts) rather than a parallel one. `categories`
 * validation mirrors the admin route's own (`/api/admin/materials/
 * [materialId]`) — plain strings, not required to come from the curated
 * config list (lib/categories/config.ts), same as an admin can tag a book
 * with an ad hoc category today. `coverSource` is the same reversible
 * own/openlibrary/google switch admin's editor already exposes (see
 * migrations/20260829_materials_cover_source.sql) — only ever meaningful
 * once lib/materials/enrichMaterial.ts's background pass has actually
 * populated an alternate to switch to; AddBookModal's edit mode only shows
 * the picker once at least one alternate source exists. Same ownership check as DELETE
 * below: only the reader who uploaded this material may edit it — never the
 * editorial catalog's `PATCH /api/admin/materials/[materialId]`, which has
 * no such restriction.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const reader = await getAuthenticatedReader(request);
  if (!reader) return unauthorized();

  const { materialId } = await params;
  const row = await resolveMaterialRow(materialId, { publishedOnly: false });
  if (!row) return notFound();
  if (row.uploaded_by !== reader.readerId) return forbidden("You can only edit your own uploads.");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return validationError("A JSON body is required.");
  const { title, author, visibility, categories, coverSource } = body as {
    title?: unknown;
    author?: unknown;
    visibility?: unknown;
    categories?: unknown;
    coverSource?: unknown;
  };

  const update: {
    title?: string;
    author?: string;
    visibility?: "personal" | "public";
    categories?: string[];
    cover_source?: "own" | "openlibrary" | "google";
  } = {};
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) return validationError("A title is required.", "title");
    update.title = title.trim();
  }
  if (author !== undefined) {
    if (typeof author !== "string") return validationError("Author must be a string.", "author");
    update.author = author.trim();
  }
  if (visibility !== undefined) {
    if (visibility !== "personal" && visibility !== "public") {
      return validationError("Visibility must be \"personal\" or \"public\".", "visibility");
    }
    update.visibility = visibility;
  }
  if (categories !== undefined) {
    const valid =
      Array.isArray(categories) &&
      categories.length <= 30 &&
      categories.every((c) => typeof c === "string" && c.trim().length > 0 && c.trim().length <= 80);
    if (!valid) return validationError("Categories must be a list of short strings.", "categories");
    update.categories = categories.map((c) => (c as string).trim());
  }
  if (coverSource !== undefined) {
    if (coverSource !== "own" && coverSource !== "openlibrary" && coverSource !== "google") {
      return validationError("coverSource must be \"own\", \"openlibrary\", or \"google\".", "coverSource");
    }
    update.cover_source = coverSource;
  }
  if (Object.keys(update).length === 0) return validationError("Nothing to update.");

  const admin = getSupabaseAdminClient();
  const { data: material, error } = await admin
    .from("materials")
    .update(update)
    .eq("id", row.id)
    .select("id, slug, title, author, cover_source")
    .single();
  if (error || !material) return notFound();

  return NextResponse.json({
    materialId: material.id,
    slug: material.slug,
    title: material.title,
    author: material.author,
    coverSource: material.cover_source,
  });
}

/**
 * A reader deleting their own upload — from HomeComposer's "x" on a
 * still-in-flight or already-uploaded attachment (reader-uploads-spec.md
 * § 3), or the library's own "remove" on a personal-library item. Distinct
 * from `DELETE /api/admin/materials/[materialId]` (admin-only, no ownership
 * check, editorial catalog): this route only ever touches a material this
 * reader themselves uploaded, and cleans up exactly the Storage objects
 * `POST /api/materials/upload` wrote for it (parsed from the row's own
 * source_url/json_storage_path/cover_url — there's no other record of which
 * objects belong to this upload, since reader uploads don't follow the
 * fixed slug-based layout deleteMaterialAssets.ts assumes for editorial
 * books).
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const reader = await getAuthenticatedReader(request);
  if (!reader) return unauthorized();

  const { materialId } = await params;
  const row = await resolveMaterialRow(materialId, { publishedOnly: false });
  if (!row) return notFound();
  if (row.uploaded_by !== reader.readerId) return forbidden("You can only delete your own uploads.");

  const admin = getSupabaseAdminClient();

  // pending_materials before materials, not after: pending_materials.material_id is
  // `on delete set null` (migrations/20260927_reader_uploads.sql), so
  // deleting materials first would null it out as part of that same
  // statement — a `delete ... where material_id = row.id` issued afterward
  // would then match nothing. Not just nulling it, either — the
  // pending_materials row is this upload's own submission record, not a
  // shared reference; deleting the material means deleting the submission
  // that produced it too, same as the material itself no longer existing.
  await admin.from("pending_materials").delete().eq("material_id", row.id);

  const { error: deleteError } = await admin.from("materials").delete().eq("id", row.id);
  if (deleteError) return notFound();
  invalidateMaterialStorage(row.slug);

  const objectPaths = [row.source_url, row.json_storage_path, row.cover_url]
    .filter((url): url is string => !!url)
    .map((url) => objectPathFromPublicUrl(STORAGE_BUCKET, url))
    .filter((path): path is string => !!path);
  const bucket = admin.storage.from(STORAGE_BUCKET);
  // A reader-uploaded EPUB's body images sit in a folder beside its JSON.
  const jsonPath = row.json_storage_path ? objectPathFromPublicUrl(STORAGE_BUCKET, row.json_storage_path) : null;
  if (jsonPath?.startsWith("uploads/")) {
    const folder = uploadImagesFolder(jsonPath);
    const { data: images } = await bucket.list(folder, { limit: MAX_UPLOAD_IMAGES });
    objectPaths.push(...(images ?? []).map((o) => `${folder}/${o.name}`));
  }
  if (objectPaths.length > 0) await bucket.remove(objectPaths);

  return NextResponse.json({ deleted: true });
}
