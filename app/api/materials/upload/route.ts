import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import { getAuthenticatedReader, isAdminReader } from "@/lib/auth/session";
import { unauthorized, validationError } from "@/lib/api/errors";
import { bucketPublicUrl, STORAGE_BUCKET } from "@/lib/storage/config";
import { deleteContentObjects, putContentObject } from "@/lib/storage/filebase";
import { parseBookDocument } from "@/lib/book/schema";
import { slugify } from "@/lib/book/epubParser";
import { enrichMaterial } from "@/lib/materials/enrichMaterial";
import { buildMaterialManifest, manifestStoragePath } from "@/lib/materials/manifest";
import { ADMIN_UPLOAD_LIMITS, MEMBER_UPLOAD_LIMITS, formatBytes } from "@/lib/materials/uploadLimits";
import { invalidateMaterialStorage } from "@/lib/materials/storageCache";
import { isUploadMaterialType, thumbnailExtension, uploadObjectPaths } from "@/lib/materials/uploadPaths";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function uniqueSlug(baseTitle: string): Promise<string> {
  const admin = getSupabaseAdminClient();
  const base = slugify(baseTitle) || "untitled";
  let candidate = base;
  for (let attempt = 1; attempt < 50; attempt++) {
    const { data } = await admin.from("materials").select("id").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${attempt + 1}`;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/**
 * Step 2 (finalize) of the single upload flow behind HomeComposer's "Add a
 * book", the library's "add a book", and /admin/library/new
 * (reader-uploads-spec.md § 3's DRY note — one server path for all). Step 1,
 * POST /api/materials/upload/sign, already had the browser PUT the bytes
 * straight into Storage; this route checks what actually landed there
 * (existence and real size, from Storage's own metadata — never the client's
 * claim), re-validates an EPUB's parsed JSON independently (never trusts a
 * client-supplied blob just because it claims to be schema-valid — same rule
 * loadBookDocuments/projectMaterial apply to every fetched BookDocument), and
 * only then records the material. Any rejection removes the uploaded objects.
 *
 * Paths come from uploadObjectPaths(readerId, uploadId) — the caller can only
 * ever finalize objects in their own uploads/ folder.
 *
 * Reader uploads publish immediately (no editorial review queue — see
 * migrations/20260927_reader_uploads.sql's RLS policy comment); `visibility`
 * (default `personal`) is what actually gates who can see it, not `status`.
 */
export async function POST(request: Request) {
  const reader = await getAuthenticatedReader(request);
  if (!reader) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as {
    uploadId?: unknown;
    materialType?: unknown;
    title?: unknown;
    author?: unknown;
    visibility?: unknown;
    pageCount?: unknown;
    thumbnailType?: unknown;
    fileName?: unknown;
    mimeType?: unknown;
  };
  const { uploadId, materialType, title, author } = body;

  if (typeof uploadId !== "string" || !UUID_PATTERN.test(uploadId)) return validationError("uploadId is required.", "uploadId");
  if (!isUploadMaterialType(materialType)) return validationError("materialType must be 'book', 'pdf', or 'docx'.", "materialType");
  if (typeof title !== "string" || !title.trim()) return validationError("A title is required.", "title");
  if (typeof author !== "string") return validationError("Author must be a string.", "author");
  const visibility = body.visibility === "public" ? "public" : "personal";

  const admin = getSupabaseAdminClient();
  const bucket = admin.storage.from(STORAGE_BUCKET);
  const paths = uploadObjectPaths(reader.readerId, uploadId, materialType, thumbnailExtension(body.thumbnailType));
  const uploadedPaths = [paths.source, paths.json, paths.thumbnail].filter((p): p is string => !!p);
  let manifestKey: string | null = null;
  const reject = async (message: string, field?: string) => {
    await bucket.remove(uploadedPaths).catch(() => {});
    if (manifestKey) await deleteContentObjects([manifestKey]).catch(() => {});
    return validationError(message, field);
  };

  // What actually landed — one listing of this upload's objects.
  const { data: listed } = await bucket.list(paths.folder, { search: uploadId, limit: 10 });
  const sizeOf = (path: string | null) => {
    if (!path) return null;
    const name = path.slice(paths.folder.length + 1);
    const size = (listed ?? []).find((o) => o.name === name)?.metadata?.size;
    return typeof size === "number" ? size : null;
  };

  const sourceSize = sizeOf(paths.source);
  if (sourceSize === null) return reject("The file didn't finish uploading. Please try again.", "sourceFile");
  const limits = isAdminReader(reader) ? ADMIN_UPLOAD_LIMITS : MEMBER_UPLOAD_LIMITS;
  if (sourceSize > limits.maxFileSizeBytes) return reject(`Files must be under ${formatBytes(limits.maxFileSizeBytes)}.`, "sourceFile");
  const thumbPath = sizeOf(paths.thumbnail) !== null ? paths.thumbnail : null;

  // Resolved up front (not down by the materials insert, as before) — the
  // book branch below needs this exact, final, de-duplicated slug to write
  // the manifest under the same key fetchMaterialManifest will look it up
  // by (manifestStoragePath(slug)), not the EPUB document's own client-side
  // slug (which can differ — see buildMaterialManifest's own doc comment).
  const slug = await uniqueSlug(title);

  let jsonStoragePath: string | null = null;
  let pageCountEstimate: number | null = null;

  if (materialType === "book") {
    const jsonSize = sizeOf(paths.json);
    // The parsed JSON of an EPUB is larger than the EPUB itself (unzipped
    // text), but not unboundedly so.
    if (jsonSize === null) return reject("Parsed book JSON is required.", "documentJson");
    if (jsonSize > limits.maxFileSizeBytes * 4) return reject("Parsed book is too large.", "documentJson");

    const { data: jsonBlob, error: downloadError } = await bucket.download(paths.json!);
    if (downloadError || !jsonBlob) return reject("Could not read the parsed book.", "documentJson");
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(await jsonBlob.text());
    } catch {
      return reject("Parsed book JSON is not valid JSON.", "documentJson");
    }
    const validated = parseBookDocument(parsedRaw);
    if (!validated.ok) return reject(`Parsed book failed schema validation: ${validated.error.message}`, "documentJson");

    // Rewritten with the validated (normalized) document rather than keeping
    // the client's bytes as-is.
    const { error: jsonUploadError } = await bucket.upload(paths.json!, JSON.stringify(validated.data), {
      contentType: "application/json",
      upsert: true,
    });
    if (jsonUploadError) return reject("Could not save the parsed book.");
    jsonStoragePath = bucketPublicUrl(STORAGE_BUCKET, paths.json!);
    pageCountEstimate = validated.data.metadata.pageCountEstimate ?? null;

    // Without this, the book detail page 404s on "manifest not found" the
    // moment a reader opens it — getMaterialDetail/projectMaterial both
    // require fetchMaterialManifest to succeed unconditionally.
    //
    // Written to Filebase, where fetchMaterialManifest reads it. Overwrites
    // deliberately: this key is the slug alone (not the uploadId prefix), so
    // it's the one object a retry of the same title can genuinely collide
    // with — `uniqueSlug` only guarantees this slug is free in the
    // `materials` table, not in storage, and an earlier failed attempt may
    // have left this exact object behind with no row pointing at it. Safe to
    // overwrite — nothing can be depending on an orphan's content.
    const manifest = buildMaterialManifest(validated.data, slug);
    try {
      await putContentObject(manifestStoragePath(slug), JSON.stringify(manifest), "application/json");
    } catch {
      return reject("Could not upload the book manifest.");
    }
    // The slug may have belonged to a since-deleted book.
    invalidateMaterialStorage(slug);
    manifestKey = manifestStoragePath(slug);
  } else if (materialType === "pdf") {
    pageCountEstimate = typeof body.pageCount === "number" && body.pageCount > 0 ? Math.round(body.pageCount) : null;
  }
  // materialType === "docx": metadata-only, no page count (see docxParser.ts)
  // — pageCountEstimate stays null.

  const { data: pending, error: pendingError } = await admin
    .from("pending_materials")
    .insert({
      submission_type: "upload",
      title: title.trim(),
      author: author.trim(),
      reader_id: reader.readerId,
      storage_path: paths.source,
      original_filename: typeof body.fileName === "string" ? body.fileName.slice(0, 500) : null,
      mime_type: typeof body.mimeType === "string" && body.mimeType ? body.mimeType.slice(0, 200) : null,
      file_size_bytes: sourceSize,
    })
    .select("id")
    .single();
  if (pendingError || !pending) return reject("Could not record this submission.");

  const { data: material, error: materialError } = await admin
    .from("materials")
    .insert({
      slug,
      material_type: materialType,
      title: title.trim(),
      author: author.trim(),
      cover_url: thumbPath ? bucketPublicUrl(STORAGE_BUCKET, thumbPath) : null,
      json_storage_path: jsonStoragePath,
      source_url: bucketPublicUrl(STORAGE_BUCKET, paths.source),
      page_count_estimate: pageCountEstimate,
      file_size_bytes: sourceSize,
      status: "published",
      uploaded_by: reader.readerId,
      visibility,
    })
    .select("id, slug, title, author")
    .single();
  if (materialError || !material) {
    await admin.from("pending_materials").delete().eq("id", pending.id);
    return reject("Could not create the library entry.");
  }

  await admin.from("pending_materials").update({ material_id: material.id, status: "approved" }).eq("id", pending.id);

  // Google Books/OpenLibrary enrichment — quietly, after this response has
  // already gone out (`after()` runs once the response is sent, in the
  // same invocation, no queue/worker needed for a single-material lookup).
  // Runs for every material type: PDFs and DOCX uploads are just as often
  // real published books as EPUBs, they just need title/author enrichment
  // instead of a cover (see enrichMaterial's own doc comment).
  after(() => enrichMaterial(material.id));

  return NextResponse.json(
    { materialId: material.id, slug: material.slug, title: material.title, author: material.author },
    { status: 201 }
  );
}
