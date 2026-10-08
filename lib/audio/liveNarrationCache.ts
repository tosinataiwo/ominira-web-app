"use client";

import { useSyncExternalStore } from "react";
import type { Passage } from "@/lib/book/schema";
import type { KaraokeWord } from "@/lib/audio/karaoke";
import { chunkWordOffsets, passageChunkTexts } from "@/lib/audio/narrationText";

export type LiveClip = {
  status: "loading" | "ready" | "error";
  src: string | undefined;
  durationMs: number;
  words: KaraokeWord[];
  error: string | undefined;
};

type NarrationMeta = { durationMs: number; words: { word: string; startMs: number; endMs: number }[] };

// Was 60, briefly dropped to 24: the real crash cause was the JSON+base64
// round-trip per clip (see app/api/narration/route.ts's own doc comment on
// the binary framing that replaced it), not the raw cached bytes
// themselves — those are cheap now that nothing decodes or stringifies
// them. Cutting this that hard mostly just shrank the cache-hit rate for
// revisited sections, forcing more real fetches through the
// MAX_CONCURRENT_FETCHES=1 pipeline below (client) and
// MAX_CONCURRENT_SYNTHESIS=1 (synthesisGate.ts, server) — both
// deliberately serial because Edge TTS stalls on concurrent connections —
// which is what turned into noticeable lag/freezing after a run of
// section jumps. 44 restores most of the old headroom for free replay
// without going back to holding 60 whole-passage blobs at once.
const MAX_CACHED_CLIPS = 44;
// 1, not 2+: the default engine (lib/audio/engines/edge.ts) talks to an
// unofficial websocket endpoint with no real SLA, and two connections
// opened at once from the same request appear to make one of them stall
// until Edge TTS's own request timeout — so prefetching still runs ahead
// of playback (each queued chunk still starts the moment the one before it
// finishes, well before playback catches up), just one request in flight
// at a time rather than in parallel.
const MAX_CONCURRENT_FETCHES = 1;

/**
 * In-memory, session-only cache of synthesized live-narration clips, keyed
 * by (book, passage, chunk, voice) — the podcast-player counterpart to a
 * prerecorded NarratorTrack. An entire section's full run of chunks (every
 * narratable passage's — see passageChunkTexts) is queued the moment it
 * becomes the narration target, so by the time playback actually reaches
 * chunk N its clip is already sitting in cache — no loading gap crossing a
 * chunk or passage boundary — and stepping back into a section visited
 * earlier this session just replays what's still cached instead of
 * re-synthesizing it.
 *
 * Chunk-, not passage-, granularity is what actually fixes a long
 * passage's lag: the overwhelming majority of passages are exactly one
 * chunk, where this changes nothing, but an unusually long one used to
 * mean the reader waited for *all* of it before hearing a single word.
 * Caching chunks as independently playable clips instead means the reader
 * only ever waits for chunk one; the rest prefetch in the background the
 * same way passages already prefetch ahead of playback within a section.
 * passageChunkTexts is pure text splitting (no network round-trip), so
 * this can enumerate a passage's chunks itself instead of asking the
 * server how many there are first.
 *
 * `bookSlug` is a cache-key namespace only, never sent to the server (see
 * app/api/narration/route.ts's own doc comment on why that route takes
 * nothing but raw text — it doesn't know what a "book" is) — it's here
 * purely to keep two different books' passages from colliding if they
 * ever happen to reuse the same structurally-generated id (e.g. two
 * books' own "13th section, 95th passage").
 *
 * Deliberately just a Map + a tiny pub/sub, not a store library: nothing
 * here needs middleware, and NarrationEngine is the only real subscriber
 * (via useLiveClip), so plain useSyncExternalStore is the whole
 * integration surface React needs.
 */
const clips = new Map<string, LiveClip>();
const inFlight = new Map<string, Promise<void>>();
// Insertion order doubles as recency for the LRU below — a re-fetch never
// happens for an entry already *ready* in `clips` (an errored entry is
// retried instead — see ensureClip), so "insertion order" and "last
// touched" coincide for everything else this cache ever does.
const order: string[] = [];
const listeners = new Map<string, Set<() => void>>();
let activeFetches = 0;
const queue: (() => void)[] = [];

/** Splits the [4-byte big-endian metadata length][JSON metadata][raw MP3
 * bytes] framing app/api/narration/route.ts sends into its two parts. No
 * base64 anywhere in this path (see that route's own doc comment on why) —
 * the audio slice is handed to `Blob` exactly as received. */
function splitNarrationBody(buf: ArrayBuffer): { meta: NarrationMeta; audio: Uint8Array<ArrayBuffer> } {
  const view = new DataView(buf);
  const metaLength = view.getUint32(0, false);
  const metaBytes = new Uint8Array(buf, 4, metaLength);
  const meta = JSON.parse(new TextDecoder().decode(metaBytes)) as NarrationMeta;
  const audio = new Uint8Array(buf, 4 + metaLength);
  return { meta, audio };
}

function keyOf(bookSlug: string, passageId: string, chunkIndex: number, voice: string): string {
  return `${bookSlug}#${passageId}#${chunkIndex}#${voice}`;
}

// Snapshotted with Array.from before iterating — a listener (narrationQueue's
// own `fill`, in practice) that synchronously unsubscribes and resubscribes
// itself to this *same* key while being called here (its ordinary
// clearWatch-then-subscribeClip cycle, whenever the target it's watching
// hasn't actually settled yet) mutates `listeners.get(key)` mid-iteration.
// A live `for...of` over the Set itself keeps visiting that re-added entry
// forever — a real, observed infinite synchronous loop (confirmed via a V8
// --prof capture showing >100M consecutive calls into this exact function,
// with zero further network activity and the tab fully hung) — since the
// Set spec has a re-inserted value re-enter a still-open iterator. Iterating
// a plain array copy instead means later mutations to the live Set can never
// affect this call's own walk.
function notify(key: string) {
  for (const l of Array.from(listeners.get(key) ?? [])) l();
}

function touch(key: string) {
  const idx = order.indexOf(key);
  if (idx >= 0) order.splice(idx, 1);
  order.push(key);
}

// The clip NarrationEngine currently has targeted — set by touchClip below,
// which fires every time narration's target changes. `order`-based recency
// alone was meant to be enough to keep eviction away from it (see
// evictExcess's own comment), but recency is a *react-effect-timed* signal:
// touchClip only runs once the target-change effect actually fires, one
// render pass after `target` itself updates, and eviction runs the instant
// any unrelated background fetch happens to finish completing, on its own
// clock, entirely decoupled from React's render/commit timing. In the
// window between "target changed" and "touchClip's effect actually ran",
// the new target's own clip — if it was fetched a while ago (a background
// prefetch revisited by stepping back into an earlier section, exactly
// what a chapter-skip does) and hasn't been touched since — could still be
// among the oldest entries in `order` and get evicted, its blob URL
// revoked, out from under the very passage about to play. Worse: eviction
// never notified `useLiveClip`'s subscribers when this happened, so the
// component kept rendering the stale (now-revoked) URL, which the
// activeSrc effect would still assign to the real <audio> element — asking
// a browser to load already-freed blob data is exactly the kind of
// operation real media stacks don't always fail cleanly on. This is an
// explicit, synchronous guard instead of a recency heuristic: whatever key
// this holds is never evicted, full stop, regardless of `order`.
let activeKey: string | undefined;

/** Evicts the oldest-touched cached clips once over the cap. `touch`/
 * `touchClip` keep the currently-playing chunk at the recent end of
 * `order`, so eviction only ever reaches clips nothing has played or
 * requested in a while — never audio actively in use — but `activeKey`
 * above is the actual guarantee, not just this recency ordering. */
function evictExcess() {
  for (let i = 0; i < order.length && order.length - i > MAX_CACHED_CLIPS; i++) {
    const key = order[i];
    if (inFlight.has(key) || key === activeKey) continue;
    const clip = clips.get(key);
    if (clip?.src) URL.revokeObjectURL(clip.src);
    clips.delete(key);
    order.splice(i, 1);
    i--;
    // Tell any subscriber (useLiveClip) this clip is gone — without this,
    // a component still rendering off this key's last-known snapshot (a
    // stale "ready" status pointing at a URL just revoked above) would
    // never find out and never re-render, no matter what actually reads it
    // next.
    notify(key);
  }
}

function runQueued() {
  while (activeFetches < MAX_CONCURRENT_FETCHES && queue.length > 0) {
    const job = queue.shift();
    job?.();
  }
}

function fetchClip(bookSlug: string, passage: Passage, chunkIndex: number, voice: string, priority: boolean): Promise<void> {
  const key = keyOf(bookSlug, passage.id, chunkIndex, voice);
  const existing = inFlight.get(key);
  if (existing) return existing;

  // Resolved once, up front, rather than inside the queued job — the
  // reader already parsed this book to display it, so the exact chunk
  // text is right here; the server (app/api/narration/route.ts) doesn't
  // look anything up by id, it just synthesizes whatever text it's given.
  const text = passageChunkTexts(passage)[chunkIndex];
  // Words spoken by this passage's earlier chunks, so word indexes run
  // passage-wide (KaraokeWord.index).
  const wordOffset = chunkWordOffsets(passage)[chunkIndex] ?? 0;

  // TEMP diagnostic (remove once the freeze-after-jumping report is
  // confirmed/ruled out) — `enqueuedAt` is captured here, before the job
  // even joins `queue`, so `waited` below reflects real time stuck behind
  // MAX_CONCURRENT_FETCHES=1 (see this file's own comment on why it's 1),
  // not just the job's own setup. A long `waited`/high `queueDepth` right
  // before a freeze points at that serialized pipeline as the cause, not a
  // memory leak.
  const enqueuedAt = performance.now();
  const promise = new Promise<void>((resolve) => {
    const job = async () => {
      activeFetches++;
      clips.set(key, { status: "loading", src: undefined, durationMs: 0, words: [], error: undefined });
      touch(key);
      notify(key);
      const waited = Math.round(performance.now() - enqueuedAt);
      try {
        if (text === undefined) throw new Error(`Passage ${passage.id} has no chunk ${chunkIndex}.`);
        const fetchStart = performance.now();
        const res = await fetch("/api/narration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice }),
        });
        console.debug(
          `[narration] ${key} priority=${priority} waited=${waited}ms fetch=${Math.round(performance.now() - fetchStart)}ms queueDepthAtStart=${queue.length}`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `Narration request failed (${res.status})`);
        }
        const { meta, audio } = splitNarrationBody(await res.arrayBuffer());
        const src = URL.createObjectURL(new Blob([audio], { type: "audio/mpeg" }));
        clips.set(key, {
          status: "ready",
          src,
          durationMs: meta.durationMs,
          words: meta.words.map((w, i) => ({
            passageId: passage.id,
            index: wordOffset + i,
            text: w.word,
            startMs: w.startMs,
            endMs: w.endMs,
          })),
          error: undefined,
        });
      } catch (err) {
        // Deliberately left retryable (see ensureClip) rather than a
        // terminal state: this engine has no SLA (edge.ts's own doc
        // comment), so a transient failure here must never mean a passage
        // can no longer ever be narrated for the rest of the session.
        clips.set(key, {
          status: "error",
          src: undefined,
          durationMs: 0,
          words: [],
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        activeFetches--;
        inFlight.delete(key);
        evictExcess();
        notify(key);
        resolve();
        runQueued();
      }
    };
    // Priority requests (whatever's about to actually play — the current
    // chunk, or the first chunk of an explicit chapter-skip/chapters-
    // drawer jump's target passage) cut to the front of the queue, ahead
    // of any section's plain background prefetch — otherwise, with only
    // one fetch in flight at a time, jumping to a new section would sit
    // behind whatever the old section's own prefetch still had left, which
    // is what made skipping look broken rather than just brief.
    //
    // A priority request deliberately does NOT cancel whatever's currently
    // occupying the one MAX_CONCURRENT_FETCHES slot (a version of this that
    // did was tried and reverted — see git history if reviving it: aborting
    // an in-flight fetch synchronously runs that job's own catch/finally,
    // including a `notify()` that can re-enter `fill()`/`ensureClip` while
    // another job's finally is still unwinding. That reentrancy is real
    // risk for a genuinely wedged state — a stale fetch finishing or
    // hitting its own timeout a few seconds late is a far smaller cost than
    // that). It still cuts the line for the *next* slot instead of queuing
    // at the back, which is most of the benefit without the risk.
    if (priority) queue.unshift(job);
    else queue.push(job);
  });

  inFlight.set(key, promise);
  runQueued();
  return promise;
}

/** Ensures one chunk is cached (or already loading) *in this voice*,
 * synthesizing it if this is the first time it's been asked for — a voice
 * change is just a different cache key, the same clip re-synthesized in a
 * different voice rather than something invalidated in place. Safe to call
 * repeatedly: a chunk already *ready* or already in flight is a no-op —
 * but one that last ended in `error` is deliberately NOT treated as
 * settled here, and gets a fresh fetchClip call instead. Without this, a
 * single transient failure (this engine has no SLA — edge.ts's own doc
 * comment) permanently bricked that exact passage for the rest of the
 * session: `clips.has(key)` is true for an errored entry same as a ready
 * one, so the old guard silently refused to ever retry it, no matter how
 * many times playback or a skip later asked for it again — the narration
 * spinner for that passage would then spin forever with no way to
 * recover short of a full reload. Pass `priority: true` for whatever's
 * about to actually play (see fetchClip's own comment) — plain background
 * prefetch (the default) queues behind it instead. */
export function ensureClip(
  bookSlug: string,
  passage: Passage,
  chunkIndex: number,
  voice: string,
  opts: { priority?: boolean } = {}
): void {
  const key = keyOf(bookSlug, passage.id, chunkIndex, voice);
  if (inFlight.has(key)) return;
  if (clips.has(key) && clips.get(key)?.status !== "error") return;
  void fetchClip(bookSlug, passage, chunkIndex, voice, opts.priority ?? false);
}

/** Marks a chunk as the one actually narrating right now — call this
 * whenever a chunk becomes the current target, so eviction never reaches
 * it (see `activeKey`'s own comment on why recency ordering alone wasn't a
 * tight enough guarantee). Also bumps it to the recent end of the eviction
 * order for when it eventually stops being the active one. */
export function touchClip(bookSlug: string, passageId: string, chunkIndex: number, voice: string): void {
  const key = keyOf(bookSlug, passageId, chunkIndex, voice);
  activeKey = key;
  if (clips.has(key)) touch(key);
}

/**
 * Queues an entire section's narratable passages — every one of their
 * chunks, in reading order, in the given voice — for background synthesis,
 * the moment the section becomes the narration target (or the voice
 * changes while it's already the target). Not gated on play actually being
 * pressed, so playback almost never has to wait on a chunk that's still
 * synthesizing. `MAX_CONCURRENT_FETCHES` keeps this from firing a burst of
 * simultaneous requests at the TTS engine; queuing in order means the
 * chunk about to play always finishes first regardless of how many others
 * are queued behind it.
 */
export function prefetchSection(bookSlug: string, passages: Passage[], voice: string): void {
  for (const passage of passages) {
    const chunkCount = passageChunkTexts(passage).length;
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
      ensureClip(bookSlug, passage, chunkIndex, voice);
    }
  }
}

function getClip(key: string): LiveClip | undefined {
  return clips.get(key);
}

/** Synchronous, non-React read of one chunk's cache state — for
 * lib/audio/narrationQueue.ts, which walks the cache imperatively to sum
 * up buffered runway rather than subscribing to any one clip via React.
 * `undefined` means neither cached nor in flight: nothing has asked for
 * this chunk yet. */
export function peekClip(bookSlug: string, passageId: string, chunkIndex: number, voice: string): LiveClip | undefined {
  return clips.get(keyOf(bookSlug, passageId, chunkIndex, voice));
}

/** Non-React subscription to one chunk's status changes — the imperative
 * counterpart to useLiveClip, for narrationQueue.ts to know when a clip it
 * kicked off (via ensureClip) has landed so it can resume filling the
 * runway. Returns an unsubscribe function. */
export function subscribeClip(
  bookSlug: string,
  passageId: string,
  chunkIndex: number,
  voice: string,
  listener: () => void
): () => void {
  const key = keyOf(bookSlug, passageId, chunkIndex, voice);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(key);
  };
}

const EMPTY_CLIP: LiveClip = { status: "loading", src: undefined, durationMs: 0, words: [], error: undefined };

/** Subscribes to one chunk's cached clip in the given voice, re-rendering
 * the caller as its status/content changes (loading → ready/error) — and,
 * since the voice is part of the key, whenever the voice itself changes
 * too (a fresh "loading" until that voice's own clip is fetched). */
export function useLiveClip(bookSlug: string, passageId: string | undefined, chunkIndex: number, voice: string): LiveClip {
  const key = passageId ? keyOf(bookSlug, passageId, chunkIndex, voice) : undefined;
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!key) return () => {};
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(onStoreChange);
      return () => {
        set!.delete(onStoreChange);
        if (set!.size === 0) listeners.delete(key);
      };
    },
    () => (key ? getClip(key) ?? EMPTY_CLIP : EMPTY_CLIP),
    // Server snapshot: the cache is a client-only, in-memory Map (nothing
    // is ever synthesized during SSR), so the server render always sees an
    // empty/loading clip regardless of key — same as a fresh client mount
    // before any fetch has resolved.
    () => EMPTY_CLIP
  );
}
