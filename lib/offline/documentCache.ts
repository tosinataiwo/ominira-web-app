/**
 * On-device copy of every source file (PDF, DOCX) a reader has opened, so a
 * document is downloaded once and then opened from disk — online or offline. Cache Storage rather than localStorage
 * (~5MB, strings only) or IndexedDB: it stores the bytes as a file-backed
 * Response, is available in Safari/iOS home-screen apps and Chrome/Android
 * alike, and is the store the service worker already uses — public/sw.js
 * keeps this cache when it clears old shell caches on activate (same name
 * there; a service worker can't import this module).
 *
 * Capped at MAX_BYTES, least recently opened dropped first. Recency lives in
 * one small JSON entry in the same cache (USAGE_PATH) rather than in the
 * documents' own order: marking a document as opened would otherwise mean
 * rewriting all of its bytes. Sharing the cache means the browser evicts the
 * record together with the files, and anything the two disagree on is
 * reconciled on the next write.
 *
 * Keyed by the document's URL. Every operation is best-effort: no Cache
 * Storage (insecure context, some private modes) or a failing read just means
 * downloading as before.
 */
const DOCUMENT_CACHE_NAME = "ominira-documents-v1";
const MAX_BYTES = 500 * 1024 * 1024;
const USAGE_PATH = "/__ominira-documents-usage";

type Usage = Record<string, { bytes: number; usedAt: number }>;

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(DOCUMENT_CACHE_NAME);
  } catch {
    return null;
  }
}

/** Absolute, so it compares equal to cache.keys()' Request URLs. */
const keyOf = (url: string) => new URL(url, location.href).href;
const usageKey = () => keyOf(USAGE_PATH);

async function readUsage(cache: Cache): Promise<Usage> {
  try {
    return (await (await cache.match(usageKey()))?.json()) ?? {};
  } catch {
    return {};
  }
}

function writeUsage(cache: Cache, usage: Usage): Promise<void> {
  return cache.put(usageKey(), new Response(JSON.stringify(usage), { headers: { "Content-Type": "application/json" } }));
}

// The usage record is read-modify-write; one queue per tab keeps an open and
// a save from overwriting each other's update.
let queue: Promise<unknown> = Promise.resolve();
function serialized(task: (cache: Cache) => Promise<void>): void {
  queue = queue.then(async () => {
    const cache = await openCache();
    if (cache) await task(cache).catch(() => {});
  });
}

export async function readCachedDocument(url: string): Promise<ArrayBuffer | null> {
  const cache = await openCache();
  if (!cache) return null;
  try {
    const cached = await cache.match(url);
    if (!cached) return null;
    const buffer = await cached.arrayBuffer();
    const key = keyOf(url);
    serialized(async (c) => {
      const usage = await readUsage(c);
      usage[key] = { bytes: buffer.byteLength, usedAt: Date.now() };
      await writeUsage(c, usage);
    });
    return buffer;
  } catch {
    return null;
  }
}

/** The usage record, matched to what's actually in the cache: entries for
 * evicted files dropped, files it doesn't know (written before it existed)
 * added as least recently used, sized from their Content-Length. */
async function reconcileUsage(cache: Cache): Promise<Usage> {
  const recorded = await readUsage(cache);
  const usage: Usage = {};
  for (const request of await cache.keys()) {
    if (request.url === usageKey()) continue;
    const known = recorded[request.url];
    if (known) {
      usage[request.url] = known;
    } else {
      const length = Number((await cache.match(request))?.headers.get("Content-Length"));
      usage[request.url] = { bytes: Number.isFinite(length) ? length : 0, usedAt: 0 };
    }
  }
  return usage;
}

let persistRequested = false;

/** Stores a verified download, first dropping the least recently opened
 * documents until it fits under MAX_BYTES. Builds the Response synchronously
 * — that copies the bytes — so the caller can hand `buffer` on (PDFium may
 * transfer it to a worker) without waiting for the write. */
export function cacheDocument(url: string, buffer: ArrayBuffer, contentType: string): void {
  const bytes = buffer.byteLength;
  if (bytes > MAX_BYTES) return;
  const response = new Response(buffer, {
    headers: { "Content-Type": contentType, "Content-Length": String(bytes) },
  });
  const key = keyOf(url);
  serialized(async (cache) => {
    // Ask the browser not to evict this origin's storage under pressure.
    // Granted for installed PWAs on Android; on iOS a home-screen app's
    // storage is already exempt from Safari's 7-day eviction.
    if (!persistRequested) {
      persistRequested = true;
      navigator.storage?.persist?.().catch(() => {});
    }
    const usage = await reconcileUsage(cache);
    delete usage[key];
    const byAge = Object.keys(usage).sort((a, b) => usage[a].usedAt - usage[b].usedAt);
    let total = byAge.reduce((sum, k) => sum + usage[k].bytes, 0);
    const evictOldest = async () => {
      const oldest = byAge.shift();
      if (!oldest) return false;
      total -= usage[oldest].bytes;
      delete usage[oldest];
      await cache.delete(oldest);
      return true;
    };
    while (total + bytes > MAX_BYTES && (await evictOldest()));
    // The device can still run out before the cap: keep dropping the least
    // recently opened until it fits. Any other failure is not ours to fix
    // by deleting documents.
    for (;;) {
      try {
        await cache.put(url, response.clone());
        break;
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "QuotaExceededError") || !(await evictOldest())) {
          await writeUsage(cache, usage);
          return;
        }
      }
    }
    usage[key] = { bytes, usedAt: Date.now() };
    await writeUsage(cache, usage);
  });
}
