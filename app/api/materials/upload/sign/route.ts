import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import { getAuthenticatedReader, isAdminReader } from "@/lib/auth/session";
import { forbidden, unauthorized, validationError } from "@/lib/api/errors";
import { readerCanUpload } from "@/lib/auth/profile";
import { STORAGE_BUCKET, bucketPublicUrl } from "@/lib/storage/config";
import { ADMIN_UPLOAD_LIMITS, MEMBER_UPLOAD_LIMITS, formatBytes } from "@/lib/materials/uploadLimits";
import { MAX_UPLOAD_IMAGES, isUploadImageName, isUploadMaterialType, thumbnailExtension, uploadObjectPaths } from "@/lib/materials/uploadPaths";

type Body = { materialType?: unknown; fileSize?: unknown; thumbnailType?: unknown; imageNames?: unknown };

/**
 * Step 1 of an upload: hands the browser signed URLs to PUT the file (and,
 * for an EPUB, its parsed JSON; for a PDF/EPUB, its cover) straight into
 * Storage, plus one per EPUB body image (under the upload's own images
 * folder; `publicUrls` lets the client point the JSON's image `src`s at
 * them before uploading it). Bytes never pass through this app's own functions — a serverless
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

  const imageNames = body.materialType === "book" && Array.isArray(body.imageNames) ? body.imageNames : [];
  if (imageNames.length > MAX_UPLOAD_IMAGES) return validationError("This book has too many images.", "imageNames");
  if (!imageNames.every(isUploadImageName) || new Set(imageNames).size !== imageNames.length) {
    return validationError("Invalid image names.", "imageNames");
  }

  const uploadId = randomUUID();
  const paths = uploadObjectPaths(reader.readerId, uploadId, body.materialType, thumbnailExtension(body.thumbnailType));
  const bucket = getSupabaseAdminClient().storage.from(STORAGE_BUCKET);

  // Images are signed with upsert so the client can retry a PUT whose
  // connection reset after the object was already stored.
  const sign = async (path: string | null, upsert = false) => {
    if (!path) return null;
    const { data, error } = await bucket.createSignedUploadUrl(path, { upsert });
    if (error || !data) throw error ?? new Error("No signed URL");
    return data.signedUrl;
  };

  try {
    const [source, json, thumbnail] = await Promise.all([sign(paths.source), sign(paths.json), sign(paths.thumbnail)]);
    // In batches: dozens of concurrent Storage calls fail with "fetch failed".
    const imageUrls: (string | null)[] = [];
    for (let i = 0; i < imageNames.length; i += 10) {
      imageUrls.push(...(await Promise.all(imageNames.slice(i, i + 10).map((name) => sign(`${paths.images}/${name}`, true)))));
    }
    const images = Object.fromEntries(imageNames.map((name, i) => [name, imageUrls[i]]));
    const publicUrls = {
      thumbnail: paths.thumbnail ? bucketPublicUrl(STORAGE_BUCKET, paths.thumbnail) : null,
      images: Object.fromEntries(imageNames.map((name) => [name, bucketPublicUrl(STORAGE_BUCKET, `${paths.images}/${name}`)])),
    };
    return NextResponse.json({ uploadId, urls: { source, json, thumbnail, images }, publicUrls });
  } catch {
    return validationError("Could not prepare this upload. Please try again.");
  }
}
