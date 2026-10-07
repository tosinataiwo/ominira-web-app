// Bumped whenever a precached file changes — activate() then drops every
// older cache, so installed apps pick up the new icon set / splash marks.
const CACHE_NAME = "ominira-shell-v12";
// Offline reading. None of these are cleared on activate — an app update
// shouldn't make readers redownload what they've already opened.
//  - documents: PDF/DOCX source files, written by the page itself
//    (lib/offline/documentCache.ts — same name there).
//  - content: book text from /api/materials/{id} — immutable per material id
//    (see that route's Cache-Control).
//  - pages: the last copy of each reader page (/read/<slug>, /reader/<slug>),
//    the offline fallback for opening a book already opened online.
//  - static: hashed /_next/static build files (JS, CSS, fonts, PDFium's
//    wasm) and PDFium's versioned CDN fallback fonts — what a cached page
//    needs to actually run.
//  - media: in-book images from Storage.
const DOCUMENT_CACHE_NAME = "ominira-documents-v1";
// content and media v2: Storage moved to a new Supabase project, so book text
// cached before then names the old host (supabase-migration.md).
const CONTENT_CACHE_NAME = "ominira-content-v2";
const PAGE_CACHE_NAME = "ominira-pages-v1";
const STATIC_CACHE_NAME = "ominira-static-v1";
const MEDIA_CACHE_NAME = "ominira-media-v2";
const KEPT_CACHES = [CACHE_NAME, DOCUMENT_CACHE_NAME, CONTENT_CACHE_NAME, PAGE_CACHE_NAME, STATIC_CACHE_NAME, MEDIA_CACHE_NAME];
// Entry caps. Pages and media are trimmed least recently used first (a hit
// re-stores the entry — see touch()), so a book reread daily outlives one
// opened once months ago. Static stays oldest-first: it grows by one build's
// worth of files per deploy, and keeping a few builds lets an older cached
// page still run.
const STATIC_MAX_ENTRIES = 600;
const MEDIA_MAX_ENTRIES = 500;
const PAGE_MAX_ENTRIES = 100;
// Launch artwork is part of the PWA shell, not page content: it needs to be
// available before a network request can complete on a cold app start. Cache
// both themes because the reader preference is restored client-side. Paths
// mirror lib/config/brand-assets.ts (a service worker can't import it).
const APP_SHELL = [
  "/",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
  "/icons/icon-192-maskable.png",
  "/icons/icon-512-maskable.png",
  "/icons/badge-96.png",
  "/icons/mark-light.webp",
  "/icons/mark-dark.webp",
  "/icons/wordmark-light.webp",
  "/icons/wordmark-dark.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !KEPT_CACHES.includes(key)).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** Re-stores a hit so it moves to the end of keys() — Cache.put replaces a
 * matching entry by appending — which is what makes trimCache drop the least
 * recently used entry rather than the least recently saved. */
function touch(event, cache, key, cached) {
  event.waitUntil(cache.put(key, cached.clone()).catch(() => {}));
}

async function trimCache(name, maxEntries) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((key) => cache.delete(key)));
}

/** Cache-first, for responses that never change at a given URL. Opaque or
 * failed responses aren't stored. `request` overrides what's fetched (and
 * keyed) — e.g. a CORS refetch of a no-cors <img>, whose opaque response
 * couldn't be checked and is padded to megabytes against the quota. `lru`
 * marks hits as recently used (see touch()). */
async function cacheFirst(event, name, { maxEntries, request = event.request, lru = false } = {}) {
  const cache = await caches.open(name);
  const cached = await cache.match(request);
  if (cached) {
    if (lru) touch(event, cache, request, cached);
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(cache.put(request, copy).then(() => (maxEntries ? trimCache(name, maxEntries) : undefined)));
  }
  return response;
}

function storeReaderPage(key, response) {
  return caches
    .open(PAGE_CACHE_NAME)
    .then((cache) => cache.put(key, response))
    .then(() => trimCache(PAGE_CACHE_NAME, PAGE_MAX_ENTRIES));
}

/** Most books open through an in-app link — a client-side RSC fetch, never a
 * navigation — so the navigation handler alone would rarely see a reader
 * page. The first time one opens that way, its full HTML is fetched once in
 * the background so it can be reopened offline; after that, an open only
 * marks the saved copy as recently used. */
async function saveOrTouchReaderPage(event, key) {
  const cache = await caches.open(PAGE_CACHE_NAME);
  const cached = await cache.match(key);
  if (cached) return touch(event, cache, key, cached);
  const response = await fetch(key, { credentials: "same-origin" });
  if (response.ok && !response.redirected) await storeReaderPage(key, response);
}

const READER_PAGE = /^\/(read|reader)\/[^/]+\/?$/;

/** Mirrors app/api/materials/[materialId]/route.ts's own content check —
 * only book content is immutable; editable fields (title, …) aren't cached. */
function isMaterialContent(url) {
  if (!/^\/api\/materials\/[^/]+$/.test(url.pathname)) return false;
  const params = url.searchParams;
  const fields = (params.get("fields") || "").split(",").map((f) => f.trim());
  return (
    params.get("fullContent") === "true" ||
    params.has("sectionId") ||
    fields.some((f) => f === "sections" || f === "narrators" || f === "notes")
  );
}

// Network-first for navigations (so readers always get fresh pages when
// online). Reader pages keep their last good copy, so a book opened online
// opens again offline; anything else falls back to the cached shell.
// Book content, build files and in-book images are cache-first (all
// immutable at their URLs). Everything else (audio, annotations, feeds, …)
// passes straight through — narration/voice-note data is generated
// per-session and isn't meant to be cached wholesale.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (request.mode === "navigate") {
    const isReaderPage = sameOrigin && READER_PAGE.test(url.pathname);
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (isReaderPage && response.ok && !response.redirected) {
            const copy = response.clone();
            // Keyed by path alone: ?section=/?page= only pick a starting
            // point, and the page restores its own position offline.
            event.waitUntil(storeReaderPage(url.origin + url.pathname, copy));
          }
          return response;
        })
        .catch(async () => {
          if (isReaderPage) {
            const key = url.origin + url.pathname;
            const pages = await caches.open(PAGE_CACHE_NAME);
            const page = await pages.match(key);
            if (page) {
              touch(event, pages, key, page);
              return page;
            }
          }
          return (await caches.match(request)) || caches.match("/");
        })
    );
    return;
  }

  // A real (not prefetch) client-side open of a reader page. Passed through
  // untouched; only the background page save rides along.
  if (
    sameOrigin &&
    READER_PAGE.test(url.pathname) &&
    request.headers.get("RSC") === "1" &&
    !request.headers.has("Next-Router-Prefetch") &&
    !request.headers.has("Next-Router-Segment-Prefetch")
  ) {
    event.waitUntil(saveOrTouchReaderPage(event, url.origin + url.pathname).catch(() => {}));
    return;
  }

  if (sameOrigin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event, STATIC_CACHE_NAME, { maxEntries: STATIC_MAX_ENTRIES }));
    return;
  }
  if (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/@embedpdf/")) {
    event.respondWith(cacheFirst(event, STATIC_CACHE_NAME, { maxEntries: STATIC_MAX_ENTRIES }));
    return;
  }
  if (sameOrigin && isMaterialContent(url)) {
    event.respondWith(cacheFirst(event, CONTENT_CACHE_NAME));
    return;
  }
  if (
    request.destination === "image" &&
    url.hostname.endsWith(".supabase.co") &&
    url.pathname.startsWith("/storage/v1/object/public/")
  ) {
    event.respondWith(
      cacheFirst(event, MEDIA_CACHE_NAME, {
        maxEntries: MEDIA_MAX_ENTRIES,
        request: new Request(url.href, { mode: "cors", credentials: "omit" }),
        lru: true,
      }).catch(() => fetch(request))
    );
    return;
  }

  if (APP_SHELL.includes(new URL(request.url).pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});

// Payload shape is lib/push/send.ts's PushPayload — { title, body, url, tag?, icon?, badge? }.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const payload = event.data.json();
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: payload.icon || "/icons/icon-192x192.png",
      // Android draws the badge from its alpha channel only — an opaque
      // square icon would render as a solid white block in the status bar.
      badge: payload.badge || "/icons/badge-96.png",
      data: { url: payload.url },
      vibrate: [100, 50, 100],
      timestamp: Date.now(),
      renotify: false,
      requireInteraction: false,
      silent: false,
      actions: [{ action: "open", title: "Open" }],
    })
  );
});

// Focuses the exact destination when it is already open. If the reader is
// open to another place in the same book, navigate that tab first — merely
// focusing it would leave the reader at the wrong note/highlight. Handles
// both the main notification click and the "Open" action button identically.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Action buttons and body clicks both navigate to the same deep link.
  // Unknown actions (if any) still fall through to the main URL.
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => {
        const current = new URL(client.url);
        return current.origin === url.origin && current.pathname === url.pathname && current.search === url.search;
      });
      if (existing) return existing.focus();
      const readerTab = clients.find((client) => {
        const current = new URL(client.url);
        return current.origin === url.origin && current.pathname === url.pathname;
      });
      if (readerTab && "navigate" in readerTab) {
        return readerTab.navigate(url.href).then((client) => client?.focus());
      }
      return self.clients.openWindow(url.href);
    })
  );
});
