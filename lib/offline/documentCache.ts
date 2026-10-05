/**
 * On-device copy of every source file (PDF, DOCX) a reader has opened, so a
 * document is downloaded once and then opened from disk — online or offline. Cache Storage rather than localStorage
 * (~5MB, strings only) or IndexedDB: it stores the bytes as a file-backed
 * Response, is available in Safari/iOS home-screen apps and Chrome/Android
 * alike, and is the store the service worker already uses — public/sw.js
 * keeps this cache when it clears old shell caches on activate (same name
 * there; a service worker can't import this module).
 *
 * Keyed by the document's URL. Every operation is best-effort: no Cache
 * Storage (insecure context, some private modes) or a failing read just means
 * downloading as before.
 */
const DOCUMENT_CACHE_NAME = "ominira-documents-v1";

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(DOCUMENT_CACHE_NAME);
  } catch {
    return null;
  }
}

export async function readCachedDocument(url: string): Promise<ArrayBuffer | null> {
  const cache = await openCache();
  if (!cache) return null;
  try {
    const cached = await cache.match(url);
    return cached ? await cached.arrayBuffer() : null;
  } catch {
    return null;
  }
}

let persistRequested = false;

/** Stores a verified download. Builds the Response synchronously — that
 * copies the bytes — so the caller can hand `buffer` on (PDFium may transfer
 * it to a worker) without waiting for the write. */
export function cacheDocument(url: string, buffer: ArrayBuffer, contentType: string): void {
  const response = new Response(buffer, {
    headers: { "Content-Type": contentType, "Content-Length": String(buffer.byteLength) },
  });
  void (async () => {
    const cache = await openCache();
    if (!cache) return;
    // Ask the browser not to evict this origin's storage under pressure.
    // Granted for installed PWAs on Android; on iOS a home-screen app's
    // storage is already exempt from Safari's 7-day eviction.
    if (!persistRequested) {
      persistRequested = true;
      navigator.storage?.persist?.().catch(() => {});
    }
    // Out of quota: drop the oldest documents (keys() is insertion order)
    // until this one fits, or give up when there's nothing left to drop.
    for (;;) {
      try {
        await cache.put(url, response.clone());
        return;
      } catch {
        const [oldest] = await cache.keys().catch(() => [] as readonly Request[]);
        if (!oldest || !(await cache.delete(oldest).catch(() => false))) return;
      }
    }
  })();
}
