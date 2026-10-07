import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import { getAuthenticatedReader, isAdminReader } from "@/lib/auth/session";
import { forbidden, unauthorized, validationError } from "@/lib/api/errors";
import { readerCanUpload } from "@/lib/auth/profile";
import { STORAGE_BUCKET } from "@/lib/storage/config";
import { ADMIN_UPLOAD_LIMITS, MEMBER_UPLOAD_LIMITS, formatBytes } from "@/lib/materials/uploadLimits";
import { isUploadMaterialType, thumbnailExtension, uploadObjectPaths } from "@/lib/materials/uploadPaths";

type Body = { materialType?: unknown; fileSize?: unknown; thumbnailType?: unknown };

/**
 * Step 1 of an upload: hands the browser signed URLs to PUT the file (and,
 * for an EPUB, its parsed JSON; for a PDF/EPUB, its cover) straight into
 * Storage. Bytes never pass through this app's own functions — a serverless
 * request body is capped at a few MB, far below a 200 MB admin upload.
 * Step 2 is POST /api/materials/upload, which checks what actually landed.
 */
export async function POST(request: Request) {
  const reader = await getAuthenticatedReader(request);
  if (!reader) return unauthorized();
  if (!(await readerCanUpload(reader))) return forbidden("Uploading books is open to approved readers only.");

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!isUploadMaterialType(body.materialType)) return validationError("materialType must be 'book', 'pdf', or 'docx'.", "materialType");
  if (typeof body.fileSize !== "number" || body.fileSize <= 0) return validationError("fileSize is required.", "fileSize");

  const limits = isAdminReader(reader) ? ADMIN_UPLOAD_LIMITS : MEMBER_UPLOAD_LIMITS;
  if (body.fileSize > limits.maxFileSizeBytes) {
    return validationError(`Files must be under ${formatBytes(limits.maxFileSizeBytes)}.`, "fileSize");
  }

  const uploadId = randomUUID();
  const paths = uploadObjectPaths(reader.readerId, uploadId, body.materialType, thumbnailExtension(body.thumbnailType));
  const bucket = getSupabaseAdminClient().storage.from(STORAGE_BUCKET);

  const sign = async (path: string | null) => {
    if (!path) return null;
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error("No signed URL");
    return data.signedUrl;
  };

  try {
    const [source, json, thumbnail] = await Promise.all([sign(paths.source), sign(paths.json), sign(paths.thumbnail)]);
    return NextResponse.json({ uploadId, urls: { source, json, thumbnail } });
  } catch {
    return validationError("Could not prepare this upload. Please try again.");
  }
}
