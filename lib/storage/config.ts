// Single bucket for all published book assets (json/covers/images/audio),
// prefixed by kind — see scripts/publish-book.ts for what writes here.
export const STORAGE_BUCKET = "library";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

/** Public CDN URL for an object path inside an arbitrary bucket — the general
 * form behind storagePublicUrl() below. Used directly by anything writing to
 * a bucket other than `library` (e.g. the `voice-notes` bucket — see
 * api-spec.md's voice-notes endpoint and models-spec.md's note on why it's a
 * separate bucket from `library`). */
export function bucketPublicUrl(bucket: string, objectPath: string): string {
  const base = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${bucket}/${objectPath}`;
}

/** Public CDN URL for an object path inside the `library` bucket, e.g. "covers/<slug>.jpg". */
export function storagePublicUrl(objectPath: string): string {
  return bucketPublicUrl(STORAGE_BUCKET, objectPath);
}

/** Inverse of bucketPublicUrl() — the object path a full public URL points
 * at inside the given bucket, or null if the URL isn't one of ours (a
 * different bucket, or not a Storage public URL at all). Used to clean up a
 * reader upload's Storage objects from the full URLs stored on its
 * `materials` row (source_url/json_storage_path/cover_url), since those are
 * the only record of which objects it owns — see DELETE /api/materials/
 * [materialId]. */
export function objectPathFromPublicUrl(bucket: string, url: string): string | null {
  const prefix = `${bucketPublicUrl(bucket, "")}`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}

/** Resolves a `materials.source_url`/`article_html_storage_path` value to a
 * fetchable URL: a `library`-bucket-relative object path, or a full URL
 * (any bucket/provider), which passes through unchanged — see
 * reader-uploads-spec.md § 1. Not for `json_storage_path`: its relative
 * paths ("books/<slug>.json") live in the private Filebase bucket, read with
 * readStorageText() (lib/storage/filebase.ts). */
export function resolveStorageUrl(pathOrUrl: string): string {
  return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : storagePublicUrl(pathOrUrl);
}
