import type { Passage } from "@/lib/book/schema";
import type { BookNarrationIndex, NarrationTarget } from "@/lib/audio/narrationIndex";
import { ensureClip, peekClip, subscribeClip } from "@/lib/audio/liveNarrationCache";

/**
 * How far ahead of the play cursor to keep audio pre-synthesized, in
 * playback time rather than a passage count — the same target a video/
 * podcast player buffers ahead of its playhead, not the whole remaining
 * book. Time, not a passage count, is what keeps this fair across a run of
 * short passages vs. a few long ones (either way, ~60s of listening
 * is buffered). Bounding it at all — rather than always sizing the buffer
 * to the differential between generation and reading speed for a book's
 * accumulated-lead — matters because a session might never come back to
 * finish the book: a real cap here is what stops a reader who's still in
 * chapter 1 from silently paying to synthesize chapter 9.
 *
 * Was 60_000, briefly dropped to 25_000 alongside liveNarrationCache's
 * MAX_CACHED_CLIPS — see that constant's own comment on why that pair was
 * cut harder than the actual crash cause (the JSON+base64 response
 * shape, since fixed) warranted: a shorter runway means less lead time
 * before playback catches up to the synthesis frontier, which is exactly
 * what read as "more noticeable lag between passages." 45s splits the
 * difference — still meaningfully less buffered than the original 60s,
 * without cutting so close to real-time that ordinary playback catches up
 * to a still-synthesizing chunk. Back at 60s now the runway no longer
 * counts the clip that's playing; memory stays bounded by
 * MAX_CACHED_CLIPS, not by this.
 */
const RUNWAY_MS = 60_000;

export type NarrationQueue = {
  /**
   * Recenters the queue on `target` (the passage/chunk the state machine has
   * decided should now be current) and keeps filling the runway forward
   * from there. `priority: true` for anything the reader is actually about
   * to hear right now (an explicit jump, or the very first call after
   * playback starts) — it cuts that one clip to the front of
   * liveNarrationCache's fetch queue; everything else this queue asks for
   * beyond it is plain background prefetch, queued behind.
   */
  setTarget(target: NarrationTarget | undefined, opts?: { priority?: boolean }): void;
  dispose(): void;
};

/**
 * Sits between the narration state machine and liveNarrationCache. The
 * cache module only knows how to fetch-and-remember one clip at a time;
 * this module is what decides *which* clips are worth asking for next, and
 * stops asking once there's already RUNWAY_MS of buffered lead — the piece
 * liveNarrationCache's own doc comment (prefetch "a whole section") used to
 * hard-code as a section-sized burst regardless of the reader's actual
 * position, and NarrationEngine's per-effect prefetch calls used to
 * duplicate ad hoc at several call sites. One queue instance is created per
 * "book currently narrating" (see narrationEngine.ts's reconciler).
 */
export function createNarrationQueue(
  bookSlug: string,
  // Accessors, not plain values: this queue instance is deliberately
  // long-lived (recreated only on a real book/voice change — see
  // NarrationEngine's own comment on why), but the book's real content
  // keeps arriving well after that (progressive loading backfills passage
  // text section by section in the background). A plain `index`/
  // `getPassage` snapshot taken at creation time would silently go stale
  // the moment more of the book loaded: `index.next` would keep walking
  // whatever (possibly much shorter) sequence existed at creation, and
  // `getPassage` would return undefined for any passage that hadn't
  // loaded yet — not erroring, just quietly never calling ensureClip for
  // it, which is exactly what made background prefetch appear to "just
  // stop" after a jump landed on newly-loaded content the queue's own
  // snapshot didn't know about yet. Calling these fresh on every fill()
  // instead means the one queue instance always sees the book as it
  // actually is right now.
  getIndex: () => BookNarrationIndex | undefined,
  getPassage: (passageId: string) => Passage | undefined,
  getVoice: () => string
): NarrationQueue {
  let currentTarget: NarrationTarget | undefined;
  // The next target this queue hasn't yet examined — starts equal to
  // currentTarget on every real setTarget, then advances one chunk at a
  // time as fill() confirms each one ready (or skips a failed one).
  // `bufferedMs` is the running total for everything already confirmed
  // between currentTarget and frontier. Both persist ACROSS fill() calls
  // (only reset by setTarget) rather than being recomputed from
  // currentTarget every time: fill() used to restart its walk from
  // currentTarget on every single clip resolution, which is correct but
  // meant filling K chunks of runway did O(1)+O(2)+...+O(K) = O(K²) total
  // peekClip work instead of O(K) — negligible for an ordinary book, but a
  // real, growing cost for one with many short passages (a quotations
  // book, say), where reaching RUNWAY_MS can take dozens of chunks, and
  // *every section jump re-triggers the whole climb* — so the wasted work
  // compounds across a session exactly the way "it's fine at first, then
  // gets worse the longer you use it" would look. Resuming from `frontier`
  // instead makes the total work across a whole runway-fill genuinely
  // linear in the number of chunks it actually has to look at.
  let frontier: NarrationTarget | undefined;
  let bufferedMs = 0;
  let unwatch: (() => void) | undefined;
  let disposed = false;

  function clearWatch() {
    unwatch?.();
    unwatch = undefined;
  }

  // Walks forward from `frontier` (not currentTarget — see its own
  // comment), summing already-cached duration into the running
  // `bufferedMs`. Stops the instant it finds a chunk that isn't ready yet:
  // kicks off (or, if already in flight, just watches) exactly that one
  // clip and returns — liveNarrationCache serializes actual fetches to one
  // at a time regardless, so queuing more than the next gap here would
  // only pile up redundant ensureClip calls, not fetch any faster.
  // Re-invoked (via the clip subscription below) every time that watched
  // clip's status changes, so it naturally keeps advancing the runway one
  // chunk at a time until RUNWAY_MS is covered or the book ends.
  function fill() {
    if (disposed || !currentTarget) return;
    const index = getIndex();
    if (!index) return;
    clearWatch();
    const voice = getVoice();
    let target = frontier;
    // A cap on chunks walked per call, not just on buffered duration: a
    // zero-duration ready clip (Edge TTS returns this whenever word-
    // boundary detection finds nothing to time, e.g. a very short passage)
    // never advances bufferedMs, so a run of them could otherwise make a
    // single call scan arbitrarily far into the book. 500 is generously
    // past any real RUNWAY_MS-worth of chunks; hitting it just means this
    // call leaves `frontier` wherever it got to and relies on the next
    // fill() to keep going from there, same as it already does whenever
    // the loop stops on a not-yet-ready chunk below.
    let stepsLeft = 500;
    while (target && stepsLeft-- > 0) {
      const clip = peekClip(bookSlug, target.passageId, target.chunkIndex, voice);
      if (clip?.status === "ready") {
        // The runway is lead *beyond* what's playing: counting the current
        // clip too let one long chunk (a split passage's first ~60s) fill
        // it alone, so the next chunk wasn't asked for until this one ended.
        if (target !== currentTarget) bufferedMs += clip.durationMs;
        target = index.next(target);
        frontier = target;
        if (bufferedMs >= RUNWAY_MS) return;
        continue;
      }
      if (clip?.status === "error") {
        // Leave a failed clip be — retrying it is the reconciler's job if
        // playback actually reaches it (re-targeting the same passage),
        // not something to hammer on every background fill.
        target = index.next(target);
        frontier = target;
        continue;
      }
      const passage = getPassage(target.passageId);
      if (passage) {
        ensureClip(bookSlug, passage, target.chunkIndex, voice, {
          // Only ever true for currentTarget itself — everything this loop
          // reaches beyond it is background runway, not what's about to play.
          priority: target === currentTarget,
        });
      }
      unwatch = subscribeClip(bookSlug, target.passageId, target.chunkIndex, voice, fill);
      return;
    }
    // Either ran off the end of the book, or hit the per-call step cap —
    // either way, `frontier` is left exactly where this call stopped, so
    // the next real setTarget (a fresh currentTarget) or subscribed
    // resolution just continues from there instead of rescanning.
  }

  return {
    setTarget(target, opts) {
      currentTarget = target;
      frontier = target;
      bufferedMs = 0;
      if (target && opts?.priority) {
        const passage = getPassage(target.passageId);
        if (passage) ensureClip(bookSlug, passage, target.chunkIndex, getVoice(), { priority: true });
      }
      fill();
    },
    dispose() {
      disposed = true;
      clearWatch();
    },
  };
}
