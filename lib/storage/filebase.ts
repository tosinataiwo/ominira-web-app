import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { unstable_cache } from "next/cache";

// Server-only S3 client for the private Filebase bucket that holds `books/`
// (book JSON, manifests, index) — route handlers and scripts, never client
// code (the secret key would ship in the bundle). Nothing in the bucket is
// publicly readable, so every read goes through readStorageText(). In-book
// images, covers and reader uploads stay in Supabase Storage.
export const FILEBASE_ENDPOINT = "https://s3.filebase.io";

let client: S3Client | undefined;

export function filebaseClient(): S3Client {
  if (!client) {
    const accessKeyId = process.env.FILEBASE_ACCESS_KEY;
    const secretAccessKey = process.env.FILEBASE_SECRET_KEY;
    if (!accessKeyId || !secretAccessKey) throw new Error("Missing FILEBASE_ACCESS_KEY or FILEBASE_SECRET_KEY");
    client = new S3Client({
      endpoint: FILEBASE_ENDPOINT,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      // The SDK otherwise adds CRC32 checksum headers to every request, an
      // AWS extension S3-compatible services don't all accept.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

export function filebaseBucket(): string {
  const name = process.env.FILEBASE_BUCKET;
  if (!name) throw new Error("Missing FILEBASE_BUCKET");
  return name;
}

export async function putContentObject(key: string, body: string | Uint8Array, contentType: string): Promise<void> {
  await filebaseClient().send(new PutObjectCommand({ Bucket: filebaseBucket(), Key: key, Body: body, ContentType: contentType }));
}

/** Book JSON and manifests never change in place: a rewrite or a freed slug
 * goes through invalidateMaterialStorage (lib/materials/storageCache.ts),
 * which clears storageCacheTag(key). So readStorageText() caches for a year. */
export const STORAGE_CACHE_SECONDS = 60 * 60 * 24 * 365;

/** Next's data cache drops any entry whose serialised form is over 2 MiB, so
 * objects are cached as base64 chunks under it: 1.4 MB of bytes is ~1.87 MB
 * of base64. A book of any size stays cached; most fit in one chunk. */
const CHUNK_BYTES = 1_400_000;

const isUrl = (pathOrUrl: string) => /^https?:\/\//.test(pathOrUrl);

/** Data-cache tag for a bucket-relative key. Full URLs (reader uploads) need
 * none: their paths are unique per upload, so their content never changes. */
export function storageCacheTag(key: string): string {
  return `storage:${key}`;
}

type Range = { bytes: Uint8Array; etag: string; size: number };

/** Bytes [start, end] of a Filebase key or a full URL, plus the object's ETag
 * and total size. With `etag`, fails if the object has changed since. */
async function readRange(pathOrUrl: string, start: number, end: number, etag?: string): Promise<Range> {
  if (isUrl(pathOrUrl)) {
    const res = await fetch(pathOrUrl, { headers: { Range: `bytes=${start}-${end}`, "Accept-Encoding": "identity" }, cache: "no-store" });
    if (res.status !== 200 && res.status !== 206) throw new Error(`Could not fetch ${pathOrUrl} (${res.status})`);
    const found = (res.headers.get("etag") ?? "").replace(/"/g, "");
    if (etag && found !== etag) throw new Error(`${pathOrUrl} changed while reading`);
    const body = new Uint8Array(await res.arrayBuffer());
    // 200: the server ignored Range and sent the whole object.
    if (res.status === 200) return { bytes: body.subarray(start, end + 1), etag: found, size: body.byteLength };
    return { bytes: body, etag: found, size: Number(res.headers.get("content-range")?.split("/")[1]) };
  }
  const object = await filebaseClient().send(
    new GetObjectCommand({ Bucket: filebaseBucket(), Key: pathOrUrl, Range: `bytes=${start}-${end}`, IfMatch: etag })
  );
  if (!object.Body) throw new Error(`Empty Filebase object ${pathOrUrl}`);
  return {
    bytes: await object.Body.transformToByteArray(),
    etag: (object.ETag ?? "").replace(/"/g, ""),
    size: Number(object.ContentRange?.split("/")[1] ?? object.ContentLength),
  };
}

/** Text of a `materials.json_storage_path`-shaped value, uncached: a
 * bucket-relative key ("books/<slug>.json") is read from Filebase with
 * credentials, a full URL (reader uploads, Supabase Storage) is fetched.
 * For scripts, which run outside Next's data cache. */
export async function fetchStorageText(pathOrUrl: string): Promise<string> {
  if (isUrl(pathOrUrl)) {
    const res = await fetch(pathOrUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not fetch ${pathOrUrl} (${res.status})`);
    return res.text();
  }
  const object = await filebaseClient().send(new GetObjectCommand({ Bucket: filebaseBucket(), Key: pathOrUrl }));
  if (!object.Body) throw new Error(`Empty Filebase object ${pathOrUrl}`);
  return object.Body.transformToString();
}

/** fetchStorageText(), kept in Next's data cache for a year whatever its
 * size. The first chunk's entry also records the ETag and size; later chunks
 * are keyed by that ETag, so a book is never assembled from two versions. If
 * the cached ETag is stale (overwritten without invalidation, then a chunk
 * evicted), it falls back to an uncached read. Throws if the object can't be
 * read. */
export async function readStorageText(pathOrUrl: string): Promise<string> {
  const options = { revalidate: STORAGE_CACHE_SECONDS, tags: isUrl(pathOrUrl) ? [] : [storageCacheTag(pathOrUrl)] };
  // The version drops every cached Filebase object at once; bump it when they're
  // all rewritten (v2: image URLs moved to the new Supabase project).
  const namespace = isUrl(pathOrUrl) ? "url" : `filebase:${filebaseBucket()}:v2`;
  const cached = <T>(parts: string[], read: () => Promise<T>) => unstable_cache(read, ["storage", namespace, pathOrUrl, ...parts], options)();
  const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

  const first = await cached(["0"], async () => {
    const range = await readRange(pathOrUrl, 0, CHUNK_BYTES - 1);
    return { etag: range.etag, size: range.size, data: toBase64(range.bytes) };
  });
  const count = Math.ceil(first.size / CHUNK_BYTES);
  try {
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, count - 1) }, (_, i) => {
        const start = (i + 1) * CHUNK_BYTES;
        return cached([first.etag, String(i + 1)], async () => toBase64((await readRange(pathOrUrl, start, start + CHUNK_BYTES - 1, first.etag)).bytes));
      })
    );
    const bytes = Buffer.concat([first.data, ...rest].map((chunk) => Buffer.from(chunk, "base64")));
    if (bytes.byteLength !== first.size) throw new Error(`${pathOrUrl}: assembled ${bytes.byteLength} bytes, expected ${first.size}`);
    return bytes.toString("utf8");
  } catch (err) {
    console.warn(`readStorageText: cached read of ${pathOrUrl} failed, reading uncached (${(err as Error).message})`);
    return fetchStorageText(pathOrUrl);
  }
}

/** Deletes `keys` (missing ones are not an error), returning the ones that
 * failed. DeleteObjects caps at 1000 keys per call. */
export async function deleteContentObjects(keys: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const result = await filebaseClient().send(
      new DeleteObjectsCommand({ Bucket: filebaseBucket(), Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } })
    );
    for (const error of result.Errors ?? []) if (error.Key) failed.push(error.Key);
  }
  return failed;
}
