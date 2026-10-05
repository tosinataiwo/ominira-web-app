import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Section } from "@/lib/book/schema";

/** Book content is public and immutable between publishes, so it's fetched
 * without apiFetch's `Authorization` header — Vercel's CDN refuses to cache
 * any request carrying one, and the route's Cache-Control (app/api/materials/
 * [materialId]/route.ts) is what keeps whole-book JSON off Fast Origin
 * Transfer. */
async function fetchContent<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

/** Walks a (possibly nested) section, collecting its own id plus every
 * descendant's — used to mark a whole fetched subtree "has real text now"
 * in one pass, since a parent section's own per-section fetch (below)
 * comes back with its children's real content already inlined too. */
function collectIds(section: Section, into: Set<string>) {
  into.add(section.id);
  for (const child of section.children) collectIds(child, into);
}

/** Swaps in `replacement` wherever its id is found in the tree, at any
 * depth — the one mutation every fetch below needs (a section arriving
 * with its real prose now that it didn't have before). Everything outside
 * the matched node's own path keeps its existing object identity, so a
 * memo keyed on an unrelated sibling section never invalidates. */
function replaceSectionById(sections: Section[], replacement: Section): Section[] {
  let changed = false;
  const next = sections.map((s) => {
    if (s.id === replacement.id) {
      changed = true;
      return replacement;
    }
    if (s.children.length > 0) {
      const children = replaceSectionById(s.children, replacement);
      if (children !== s.children) {
        changed = true;
        return { ...s, children };
      }
    }
    return s;
  });
  return changed ? next : sections;
}

/**
 * Fills in a book's real prose progressively, on top of whatever the server
 * already sent (see toBookDocument.ts's own doc comment: every section's
 * structure is always real from the start, only `passage.text` on
 * non-eager sections starts blank). Three things happen here:
 *
 *  - `ensureTextLoaded(sectionId)` — ships that one section's real content
 *    via the existing per-section endpoint
 *    (`GET /api/materials/{id}?fields=sections&sectionId=`, unchanged,
 *    already used by the book-detail page's chapter links). Cheap, and a
 *    no-op if already loaded or already in flight.
 *  - `loadAllTextInBackground()` — the "rest of the book, at once" wave:
 *    one call to the same whole-book endpoint the old blocking load always
 *    used (`fullContent=true`), fired once, after the reader can already
 *    see their own starting section. A book with no unloaded sections left
 *    (a short book the server's own single eager section already covered
 *    entirely) still safely no-ops here — merging in content that's
 *    already real changes nothing. Its own response is always the complete,
 *    real tree regardless of whatever `ensureTextLoaded` calls may also be
 *    in flight for individual sections — both read the same immutable book
 *    content, so there's nothing to reconcile between them.
 *  - `isTextLoaded(sectionId)` — for callers that want to know before
 *    deciding whether to await `ensureTextLoaded` at all.
 *
 * Both fetches are best-effort and degrade gracefully on a dropped request
 * (a blank section, not a crash) — but neither retried itself before this:
 * once caught, that was the end of it until something external (a fresh
 * mount, or another explicit `ensureTextLoaded` call for that one section)
 * happened to ask again. Offline mid-load — the PWA's actual failure mode,
 * not a flaky server — never triggered either of those on its own, so a
 * reader who lost signal partway through a book just stayed with whatever
 * had already arrived, permanently, even after reconnecting. The `online`
 * listener below is what actually recovers from that: every failed
 * section, and the whole-book wave if it never finished, gets retried the
 * moment the browser reports connectivity again — no polling, no guessing
 * whether the network is back. This is also the deliberate seam for full
 * offline support later: a service worker/background-sync handoff would
 * swap out *what* triggers a retry, not the retry bookkeeping itself
 * (`failedSectionIdsRef`/`backgroundFailedRef` below), which is the part
 * worth getting right now.
 *
 * `sections` is the live, ever-more-complete tree — every existing reader
 * consumer (orderedSections, passageLookup, search, the book-wide notes
 * feed) reads off this instead of the original static prop, so they all
 * improve automatically as more of the book arrives, with no separate
 * "is this stale" bookkeeping of their own.
 */
export function useProgressiveText({
  materialId,
  initialSections,
  eagerSectionIds,
}: {
  materialId: string;
  initialSections: Section[];
  eagerSectionIds: string[];
}) {
  const [sections, setSections] = useState(initialSections);
  const loadedIdsRef = useRef(new Set(eagerSectionIds));
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  // Sections whose fetch has failed and not yet been retried successfully —
  // the online-retry effect below sweeps this on reconnect. Never touched
  // by anything else's success/failure but its own.
  const failedSectionIdsRef = useRef(new Set<string>());
  const backgroundPromiseRef = useRef<Promise<Section[]> | null>(null);
  const backgroundFailedRef = useRef(false);

  const isTextLoaded = useCallback((sectionId: string) => loadedIdsRef.current.has(sectionId), []);

  const ensureTextLoaded = useCallback(
    (sectionId: string): Promise<void> => {
      if (loadedIdsRef.current.has(sectionId)) {
        failedSectionIdsRef.current.delete(sectionId);
        return Promise.resolve();
      }
      const existing = inFlightRef.current.get(sectionId);
      if (existing) return existing;

      const promise = fetchContent<{ sections: Section }>(
        `/materials/${materialId}?fields=sections&sectionId=${encodeURIComponent(sectionId)}`
      )
        .then((data) => {
          setSections((prev) => replaceSectionById(prev, data.sections));
          collectIds(data.sections, loadedIdsRef.current);
          failedSectionIdsRef.current.delete(sectionId);
        })
        .catch(() => {
          // Best-effort — this section just stays blank for now. Recorded
          // here rather than left to die silently: the online-retry effect
          // below is what actually gives it another shot once connectivity
          // returns, on top of the pre-existing "next mount, or another
          // ensureTextLoaded call for it" paths.
          failedSectionIdsRef.current.add(sectionId);
        })
        .finally(() => {
          inFlightRef.current.delete(sectionId);
        });
      inFlightRef.current.set(sectionId, promise);
      return promise;
    },
    [materialId]
  );

  // Fired exactly once per Reader mount, right after the reader's own
  // starting section is confirmed ready — every remaining section's real
  // prose, in one request, same endpoint the whole reader always used to
  // block on. Also re-fired by the online-retry effect below whenever the
  // first attempt didn't make it — `backgroundPromiseRef` is reset to null
  // on failure specifically so this guard lets a real retry happen instead
  // of forever returning the same dead, already-caught promise.
  const loadAllTextInBackground = useCallback((): Promise<Section[]> => {
    if (!backgroundPromiseRef.current) {
      backgroundPromiseRef.current = fetchContent<{ sections: Section[] }>(
        `/materials/${materialId}?fields=sections&fullContent=true`
      )
        .then((data) => {
          setSections(data.sections);
          for (const s of data.sections) collectIds(s, loadedIdsRef.current);
          backgroundFailedRef.current = false;
          return data.sections;
        })
        .catch(() => {
          // Sections simply stay whatever they already were — each one
          // remains individually fetchable via ensureTextLoaded on demand
          // (e.g. as the reader navigates), so a dropped background call
          // degrades to "loads on demand" rather than "broken". Clearing
          // the ref (rather than leaving this settled promise cached
          // forever) is what makes "loads on demand" actually include
          // "reconnecting" as one of the demands.
          backgroundFailedRef.current = true;
          backgroundPromiseRef.current = null;
          return sections;
        });
    }
    return backgroundPromiseRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sections` here is only the fallback value for an already-dropped request; including it would re-create this callback (and its memoized identity, which Reader.tsx's own once-per-mount effect relies on) on every text update.
  }, [materialId]);

  // The actual recovery: the browser's own 'online' event is the one
  // reliable signal that a dropped request is now worth retrying, without
  // polling or guessing. Retries every section ensureTextLoaded gave up on,
  // plus the whole-book wave if it never completed — both callbacks are
  // themselves idempotent/deduped (loadedIdsRef/inFlightRef,
  // backgroundPromiseRef), so this never double-fetches anything already
  // loaded or already in flight.
  useEffect(() => {
    const onOnline = () => {
      for (const sectionId of failedSectionIdsRef.current) ensureTextLoaded(sectionId);
      if (backgroundFailedRef.current) loadAllTextInBackground();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [ensureTextLoaded, loadAllTextInBackground]);

  return useMemo(
    () => ({ sections, isTextLoaded, ensureTextLoaded, loadAllTextInBackground }),
    [sections, isTextLoaded, ensureTextLoaded, loadAllTextInBackground]
  );
}
