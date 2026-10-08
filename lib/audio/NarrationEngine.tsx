"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAudioStore } from "@/stores/audio-store";
import { useReadingPositionStore } from "@/stores/reading-position-store";
import { useNarrationStore } from "@/stores/narration-store";
import { buildPassageIndex, buildSectionsById } from "@/lib/reader/sections";
import { locatorPercent } from "@/lib/reader/locator";
import { listenLocator, locatorPlace, narrationScale } from "@/lib/audio/narrationDocument";
import { chunkWordOffsets, hasNarratableText } from "@/lib/audio/narrationText";
import { buildNarrationIndex, type NarrationTarget } from "@/lib/audio/narrationIndex";
import { createNarrationQueue, type NarrationQueue } from "@/lib/audio/narrationQueue";
import { ensureClip, touchClip, useLiveClip } from "@/lib/audio/liveNarrationCache";
import { registerNarrationElement } from "@/lib/audio/narrationTap";
import { activeWordIndex, type KaraokeWord } from "@/lib/audio/karaoke";
import type { Passage, Section } from "@/lib/book/schema";

// HTMLMediaElement's own time-stretching (what playbackRate drives) can run
// in either of two modes: pitch-corrected (the speech stays the same pitch,
// just faster/slower — what every podcast app's speed control sounds like)
// or naive resampling (pitch rises/falls with speed — a chipmunk at 1.5x, a
// growl at 0.75x, and audibly "off" rather than just faster). Which one a
// browser defaults to is inconsistent (and Safari has shipped both
// defaults across versions), so this is set explicitly, every time
// playbackRate itself is set, rather than trusted to the platform default —
// `preservesPitch` is the standard property name; the two prefixed ones are
// what older WebKit/Gecko still expect.
function setPlaybackRate(audio: HTMLAudioElement, rate: number) {
  audio.playbackRate = rate;
  audio.preservesPitch = true;
  const legacy = audio as HTMLAudioElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
  legacy.webkitPreservesPitch = true;
  legacy.mozPreservesPitch = true;
}

/**
 * Owns narration playback for whichever book is currently "now playing"
 * (audio-store's `book`) — mounted exactly once, in the root layout, so it
 * survives navigation between the reader and the library (reader-issues:
 * podcast-style playback must follow the reader across pages, not just
 * across sections of one book).
 *
 * Every book plays through live AI narration right now: lib/audio/
 * narrationIndex flattens the whole book into one spine-ordered sequence of
 * passages (a whole passage is the synthesis unit — see narrationText.ts's
 * own doc comment on why it's not split into sentences), lib/audio/
 * narrationQueue keeps ~60s of it synthesized ahead of whichever one is
 * current (via the Edge engine, lib/audio/engines/edge.ts), and lib/audio/
 * liveNarrationCache caches the results for the rest of the session — so
 * by the time playback actually reaches passage N its clip is normally
 * already there, and stepping back into an earlier section just replays
 * what's cached instead of re-synthesizing it.
 *
 * The one piece of state this file is organized around is `target`
 * (NarrationTarget: section + passage + chunk, chunk almost always 0 —
 * every ordinary passage is a single chunk) — every control (play/pause
 * aside, which is a separate isPlaying intent) goes through
 * `requestTarget`, including the 'ended' auto-advance handler. That
 * symmetry is deliberate: there is no separate "default flow" vs. "explicit
 * jump flow" — a chapter boundary crossed by natural playback and a chapter
 * boundary crossed by tapping the skip button both just ask
 * lib/audio/narrationIndex for the next target and hand it to the same
 * function.
 *
 * A published-audiobook path (Section.audio.narratorTracks — one real
 * prerecorded file per section, e.g. TTSEngine.md's Chatterbox pipeline)
 * exists in the book schema, but no book actually has one yet, and the
 * dual-mode branching that used to sit throughout this file for it (a
 * second duration/seek/word-timing model, an audioTimeMs-based resume, a
 * separate section-end advance effect) was real complexity spent on a path
 * nothing exercises — actively getting in the way of tuning the one
 * experience every reader actually gets. Deleted rather than left dormant,
 * on purpose: reviving it later is exactly the shape this file had before
 * (git history has it), and should come back alongside real AudioPlayer UI
 * for a fixed-duration track — not as an inert half-built branch every
 * future edit here has to keep reasoning around for a case that can't
 * currently happen.
 *
 * This renders nothing. It exists purely to own the one real
 * `<audio>` element and push derived state into narration-store, which is
 * what NowPlayingBar and Reader (whichever book they're each showing)
 * actually read. Splitting it this way — rather than a plain hook — is
 * required because only one component may ever construct the `Audio()`
 * instance; a hook called from two places (root player bar + the reader
 * page for the same book) would otherwise create two.
 */
export default function NarrationEngine() {
  const book = useAudioStore((s) => s.book);
  const materialId = useAudioStore((s) => s.materialId);
  const audioPlaying = useAudioStore((s) => s.isPlaying);
  const audioCurrentTimeMs = useAudioStore((s) => s.currentTimeMs);
  const audioSpeed = useAudioStore((s) => s.speed);
  const voice = useAudioStore((s) => s.voice);
  const startAtPassage = useAudioStore((s) => s.startAtPassage);

  const getPosition = useReadingPositionStore((s) => s.getPosition);
  const setPosition = useReadingPositionStore((s) => s.setPosition);

  const sectionsById = useMemo(
    () => (book ? buildSectionsById(book.sections) : new Map<string, Section>()),
    [book]
  );
  // buildPassageIndex, not a hand-rolled shallow scan of book.sections —
  // sections nest under Part groupings (.children), the same reason
  // narrationIndex.ts had to switch to the recursive buildSectionsById
  // instead of a shallow `.find`. A shallow scan here silently dropped
  // every passage belonging to a nested section from this map entirely, so
  // ensureClip/seekToPassageForListening could never
  // resolve a real Passage for them (`getPassage(id)` returned undefined)
  // — no error, just a target that could never actually kick off a fetch:
  // a book with any Part-grouped chapter (common) silently never narrated
  // a single one of them.
  const passageIndex = useMemo(() => (book ? buildPassageIndex(book.sections) : new Map()), [book]);
  const passageById = useCallback((id: string): Passage | undefined => passageIndex.get(id)?.passage, [passageIndex]);
  const narrationIndex = useMemo(() => (book ? buildNarrationIndex(book) : undefined), [book]);
  const progressScale = useMemo(() => (book ? narrationScale(book) : undefined), [book]);
  /**
   * Records where listening has got to, in the same one-record-per-material
   * shape plain reading writes (stores/reading-position-store.ts) — so the
   * local mirror, and once synced the server's own
   * CurrentReadingEntry.progressPercent, reflect listen-mode progress too,
   * not just useReadingProgress's own writes.
   *
   * `mode: "listen"` is what tells every resume affordance downstream that
   * this reader left by the listening door and should be sent back through
   * it; `audioTimeMs` refines the position further *within* the located
   * passage, which is why it's carried alongside the locator rather than
   * being part of it.
   */
  const persistListenPosition = useCallback(
    (sectionId: string, passageIndex: number, audioTimeMs: number) => {
      if (!materialId || !book) return;
      const locator = listenLocator(book, sectionId, passageIndex);
      setPosition(materialId, {
        locator,
        mode: "listen",
        audioTimeMs,
        progressPercent: locatorPercent(progressScale, locator),
      });
    },
    [materialId, book, setPosition, progressScale]
  );

  // The one piece of state everything else in this file is derived from or
  // feeds into — see the module doc comment. `undefined` means "no target
  // yet" (book just opened, still resolving where to resume) or "off the
  // end of the book".
  const [target, setTarget] = useState<NarrationTarget | undefined>(undefined);
  const isNarrating = Boolean(book && target);

  const audioSection = target ? sectionsById.get(target.sectionId) : undefined;
  const audioIndex = book && audioSection ? book.spine.indexOf(audioSection.id) : -1;
  const currentPlayingPassageId = target?.passageId;

  // "Latest" refs for narrationIndex/passageById — kept current every
  // render (not just when the queue is recreated) so the accessors handed
  // to createNarrationQueue below never go stale. See that function's own
  // doc comment on why a plain snapshot silently broke background
  // prefetch the moment more of the book loaded after the queue was
  // created.
  const narrationIndexRef = useRef(narrationIndex);
  const passageByIdRef = useRef(passageById);
  useEffect(() => {
    narrationIndexRef.current = narrationIndex;
    passageByIdRef.current = passageById;
  });
  const getNarrationIndex = useCallback(() => narrationIndexRef.current, []);
  const getPassageLive = useCallback((id: string) => passageByIdRef.current(id), []);

  // The runway-bounded background-synthesis queue (lib/audio/
  // narrationQueue.ts) — one instance per book, recreated whenever the
  // "now playing" book itself changes (a different slug is a different
  // passage sequence and cache namespace entirely). Not recreated on a
  // section/passage/voice change within the same book — setTarget below
  // handles all of those against the one instance.
  const queueRef = useRef<NarrationQueue | undefined>(undefined);
  useEffect(() => {
    queueRef.current?.dispose();
    queueRef.current = book ? createNarrationQueue(book.slug, getNarrationIndex, getPassageLive, () => voice) : undefined;
    return () => queueRef.current?.dispose();
    // Recreated on a voice change too, not just a book change: simplest way
    // to guarantee the queue's own `getVoice` closure is never stale
    // without threading a ref through it. Cheap to do — the next effect
    // (setTarget) immediately re-centers the fresh instance, and
    // liveNarrationCache's own cache is unaffected (it's a separate module,
    // keyed by voice already).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on book/voice identity, not full book equality; getNarrationIndex/getPassageLive are stable (empty-dep useCallback)
  }, [book?.slug, voice, getNarrationIndex, getPassageLive]);

  // Stops the real element outright rather than rewinding it — used by
  // requestTarget below for every genuine clip switch (a passage/section
  // change is always a different clip; there's no mid-clip resume — see the
  // module doc comment on why the old prerecorded-track model's
  // audioTimeMs offset doesn't apply here). Rewinding only resets position;
  // if the element was still actively playing the old clip it would just
  // keep playing that same old content from its own beginning until the
  // new source eventually swapped in — audibly "repeating the last
  // passage" for however long that took. Clearing the src stops it
  // outright; the activeSrc effect below picks up the new source (once
  // it's ready) and resumes playback from there.
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // Set right before stopCurrentAudio calls audio.pause() to switch
  // sources. The 'pause' event it triggers fires asynchronously, landing
  // *after* the caller has already called play() to mark intent to keep
  // playing, so onPause below needs a way to tell "we did this on purpose,
  // mid-switch" apart from a real pause — without it, this flag-less event
  // would win the race and flip isPlaying back to false right after it was
  // just set true, and the new clip would sit there loaded and ready
  // without ever actually starting.
  const suppressPauseEventRef = useRef(false);
  const stopCurrentAudio = useCallback(() => {
    const audio = audioElRef.current;
    if (audio) {
      if (!audio.paused) suppressPauseEventRef.current = true;
      audio.pause();
      audio.removeAttribute("src");
    }
    // Not resetting audioSrcRef here: the target is always changing when
    // this is called, so the new clip's src (once loaded) is guaranteed to
    // differ from whatever's still in the ref, and the src-swap effect
    // below picks it up on its own regular comparison.
    useAudioStore.getState().seekTo(0);
    // No word until the next clip plays (see publishWord).
    useNarrationStore.setState({ currentWord: null });
  }, []);

  // Bumped once per *explicit* jump — a reader-initiated section/passage
  // change (chapter-skip buttons, chapters drawer, clicking a
  // paragraph), as opposed to the 'ended' handler quietly advancing on
  // its own. Pushed into narration-store below so Reader.tsx's carousel-
  // follow effect (its own single consumer) can tell the two apart — see
  // that store field's own doc comment for why this replaced Reader
  // calling its own navigateToSection directly from the chapters drawer:
  // two independent call sites were each deciding "what section is the
  // reader looking at" for the same click, racing each other. Living here,
  // bumped from inside the one reconciler every explicit jump already goes
  // through, means there is exactly one producer of this signal, matching
  // requestTarget's own "one entry point" role for narration state itself.
  const [explicitJumpSeq, setExplicitJumpSeq] = useState(0);

  // The one entry point every control in this file uses to change what's
  // narrating — the state-machine "reconciler". `next` is either an actual
  // passage/chunk (switch to it, write it as the new resume bookmark, keep/start
  // playing) or undefined (nothing more to narrate: book/section exhausted,
  // or the target passage had nothing narratable — stop cleanly).
  // `opts.explicit` marks a reader-initiated jump (see explicitJumpSeq
  // above) — left false for the 'ended' auto-advance handler below, the
  // one caller that must NOT force the reader's view to follow.
  const requestTarget = useCallback(
    (next: NarrationTarget | undefined, opts?: { explicit?: boolean }) => {
      stopCurrentAudio();
      if (!next || !materialId) {
        setTarget(undefined);
        if (!next) useAudioStore.getState().pause();
        return;
      }
      const section = sectionsById.get(next.sectionId);
      const passageIndex = section?.passages.findIndex((p) => p.id === next.passageId) ?? -1;
      if (passageIndex >= 0) persistListenPosition(next.sectionId, passageIndex, 0);
      setTarget(next);
      if (opts?.explicit) setExplicitJumpSeq((n) => n + 1);
      // Marks the new target's clip protected from eviction *synchronously*
      // here, not only via the separate `[book, target, voice]` effect
      // further down — that effect only runs a render pass after this
      // state update commits, and liveNarrationCache's own eviction runs
      // on an unrelated background fetch's own completion, entirely off
      // React's clock. In that window, a clip fetched a while ago (a
      // background prefetch a chapter-skip is now revisiting) could still
      // be evicted before the effect ever got a chance to protect it. See
      // liveNarrationCache's own `activeKey` comment for the full story —
      // this is the fix for exactly the hang that produced.
      if (book) touchClip(book.slug, next.passageId, next.chunkIndex, voice);
    },
    [materialId, sectionsById, persistListenPosition, stopCurrentAudio, book, voice]
  );

  // Resolves where to start once a book becomes "now playing" — resumes
  // the passage reading-position-store last had bookmarked for it (always
  // starting at that passage's first chunk (always chunk 0 in practice); there's no persisted
  // chunk-level offset, same as there never being a persisted mid-clip
  // offset before), or the book's very first narratable passage otherwise.
  //
  // Retries as narrationIndex itself changes (not just once per book/
  // materialId identity) until it actually lands on a real target —
  // `resumeResolvedForRef` is what stops it from re-firing forever once it
  // has. Without the retry, opening listen mode straight from the book-
  // detail page's own Listen button (a fresh page load: only the eager
  // section has real prose yet, everything else is still blank pending
  // progressive loading) could compute `narrationIndex.targets` as empty —
  // nothing narratable found yet — and set `target` to `undefined`
  // permanently, since nothing else ever re-asks this question once the
  // rest of the book's real text actually arrives moments later. That
  // silently looked like "Listen does nothing at all": no target, so no
  // ensureClip call, so no network request, and every control gated on
  // isNarrating (skip buttons, the karaoke highlight) stayed dead until
  // the reader happened to trigger a real target some other way (e.g. the
  // chapters drawer, which resolves its own target fresh off whatever
  // narrationIndex looks like at click time).
  const resumeResolvedForRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!book || !materialId) return;
    const bookKey = `${book.slug}:${materialId}`;
    if (resumeResolvedForRef.current === bookKey) return;
    if (!narrationIndex) return;
    // Resumes from the saved position — listening's, or wherever plain
    // reading left off — at the first narratable passage from there in its
    // section (a saved heading image, say, moves on to the text after it).
    // A position saved in another format's terms, or one with nothing
    // narratable after it, falls back to the book's actual first narratable
    // passage — not narrationIndex.firstOf(book.spine[0]), which returns
    // undefined whenever the spine's literal first section has nothing
    // narratable in it (a cover-image-only section is common as spine[0]).
    const place = locatorPlace(book, getPosition(materialId)?.locator);
    const placeSection = place ? sectionsById.get(place.sectionId) : undefined;
    const resumePassage = placeSection?.passages.slice(Math.max(0, place!.passageIndex)).find(hasNarratableText);
    // Nothing narratable left in that section (an image-only PDF page, say):
    // the first narratable passage of a later section.
    const placeOrder = place ? book.spine.indexOf(place.sectionId) : -1;
    const spineOrder = new Map(book.spine.map((id, i) => [id, i]));
    const resumeTarget: NarrationTarget | undefined =
      placeSection && resumePassage
        ? { sectionId: placeSection.id, passageId: resumePassage.id, chunkIndex: 0 }
        : (placeOrder >= 0 ? narrationIndex.targets.find((t) => (spineOrder.get(t.sectionId) ?? -1) > placeOrder) : undefined) ??
          narrationIndex.targets[0];
    // Nothing narratable loaded yet (progressive loading still catching
    // up) — leave resumeResolvedForRef untouched so the next narrationIndex
    // recompute (more content arriving) gets a real shot at this too,
    // instead of settling for "nothing to narrate" permanently.
    if (!resumeTarget) return;
    resumeResolvedForRef.current = bookKey;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resolving a resume target from storage on book-open, not derived render state
    setTarget(resumeTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on book.slug identity, not full book equality
  }, [book?.slug, materialId, narrationIndex, sectionsById, getPosition]);

  // Keeps the background queue centered on wherever playback currently is —
  // fires for every target change, from any source (resume, chapter-skip,
  // word-tap, or the 'ended' auto-advance below), and again on a voice
  // switch (a new voice is a different cache key throughout, so the queue
  // needs to re-fill under it even though the target itself didn't move).
  useEffect(() => {
    queueRef.current?.setTarget(target, { priority: true });
  }, [target, voice]);

  // Keeps the currently-targeted clip marked as recently used so the
  // cache's LRU eviction never reclaims it out from under active playback.
  useEffect(() => {
    if (!book || !target) return;
    touchClip(book.slug, target.passageId, target.chunkIndex, voice);
  }, [book, target, voice]);

  const live = useLiveClip(book?.slug ?? "", target?.passageId, target?.chunkIndex ?? 0, voice);
  const activeSrc = live.src;
  const activeDurationMs = live.durationMs;
  // "Buffering" whenever the passage currently targeted isn't playable yet
  // — either still synthesizing, or the last attempt failed (the retry
  // effect right below keeps re-asking for it, so an error here still
  // reads as "buffering" rather than a dead end).
  const isBuffering = isNarrating && live.status !== "ready";

  // Retries a currently-targeted clip that failed to synthesize — nothing
  // else in this file ever re-asks for a passage once it's already the
  // target (requestTarget's own queueRef effect only fires again on a real
  // target/voice *change*), so without this, one transient failure against
  // an engine with no SLA (edge.ts's own doc comment) left the reader
  // staring at a buffering spinner that could never resolve on its own —
  // exactly the frozen-loader symptom a skip/jump landing on a passage hit
  // by a momentary Edge TTS hiccup produced. Backs off a couple seconds
  // between attempts rather than hammering it, and stops entirely once the
  // clip is no longer the live target (the cleanup below) or turns ready.
  useEffect(() => {
    if (!book || !target || live.status !== "error") return;
    const passage = passageById(target.passageId);
    if (!passage) return;
    const timer = setTimeout(() => {
      ensureClip(book.slug, passage, target.chunkIndex, voice, { priority: true });
    }, 2000);
    return () => clearTimeout(timer);
  }, [book, target, live.status, voice, passageById]);

  // The actual <audio> element — created once, client-side only, and
  // controlled imperatively rather than rendered, the same way
  // NotesSidebar's voice-memo playback works.
  const audioSrcRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const audio = new Audio();
    audioElRef.current = audio;
    // For a reading room to send the narration (narrationTap.ts).
    registerNarrationElement(audio);

    // Keeps the play/pause icon in sync with the *real* element instead of
    // only the store — an OS/keyboard media key (or another tab's media
    // session) can pause the element directly, bypassing every action here
    // entirely, and without this the UI would keep showing "playing"
    // forever. Guarded on `audio.ended`: a track finishing on its own also
    // fires a native 'pause' (per the HTML spec's "reaches the end"
    // algorithm sets paused=true before firing it), which must NOT be
    // reported as a user pause — the advance effect below is about to hand
    // the element a new source and keep going. Also guarded on
    // suppressPauseEventRef — see its own comment.
    const onPlay = () => useAudioStore.getState().play();
    const onPause = () => {
      if (audio.ended) return;
      if (suppressPauseEventRef.current) {
        suppressPauseEventRef.current = false;
        return;
      }
      useAudioStore.getState().pause();
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.pause();
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audioElRef.current = null;
      registerNarrationElement(null);
    };
  }, []);

  // Tears the real element down entirely once the player is closed
  // outright (audio-store's closePlayer sets `book` to null) — every other
  // effect in this file gates on `isNarrating`, which is exactly `Boolean
  // (book && target)`, so the instant `book` goes away isNarrating flips to
  // false and the play/pause-sync effect below (`[isNarrating,
  // audioPlaying]`) stops touching the element at all rather than actually
  // pausing it. Closing the player while playing used to leave whatever
  // clip the element already had loaded (it's a real <audio> element with
  // a real src, independent of React state) simply running until that
  // passage finished on its own — pause/play themselves looked fine
  // because those go through the same [isNarrating, audioPlaying] effect
  // while `book` is still set, so the inconsistency only ever showed up on
  // an outright close. Also resets audioSrcRef and the resume-resolution
  // ref, not just `target`: without the former, reopening the very same
  // book at the very same resume passage — a real case, since
  // liveNarrationCache's clip cache survives a close — would see the new
  // activeSrc match this stale ref and skip re-assigning `audio.src`,
  // even though the element's own src attribute was just removed above;
  // without the latter, reopening would skip resolving a fresh resume
  // target at all (see that effect's own doc comment).
  useEffect(() => {
    if (book) return;
    const audio = audioElRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    audioSrcRef.current = undefined;
    resumeResolvedForRef.current = undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tearing down narration state in reaction to `book` going away, not derived render state
    setTarget(undefined);
  }, [book]);

  // Points the element at the live engine's freshly-fetched clip. Compared
  // against a ref rather than audio.src (which the browser resolves to an
  // absolute URL) so a re-render with the same source never resets
  // playback position. Explicitly resumes playback on the new source when
  // already playing — assigning `.src` always pauses the element, and
  // without this an auto-advance to the next passage/section would
  // otherwise go silent instead of continuing.
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio) return;
    if (activeSrc === audioSrcRef.current) return;
    audioSrcRef.current = activeSrc;
    if (activeSrc) audio.src = activeSrc;
    else audio.removeAttribute("src");
    // Assigning `.src` runs the element through the browser's media load
    // algorithm, which resets playbackRate (and preservesPitch alongside
    // it) back to defaults in Safari (and can on other engines too) —
    // reapply immediately so a chapter auto-advance or skip doesn't
    // silently drop the reader back to 1x, or back to un-pitch-corrected
    // speed.
    setPlaybackRate(audio, useAudioStore.getState().speed);
    // Reverts the store's play intent on rejection (e.g. iOS refusing an
    // autoplay-policy-gated resume) — otherwise isPlaying stays stuck at
    // true even though the element never actually started, showing a
    // pause icon that misrepresents silence until the user taps pause and
    // play again.
    if (activeSrc && useAudioStore.getState().isPlaying) {
      audio.play().catch(() => useAudioStore.getState().pause());
    }
  }, [activeSrc]);

  useEffect(() => {
    if (audioElRef.current) setPlaybackRate(audioElRef.current, audioSpeed);
  }, [audioSpeed]);

  // Belt-and-suspenders: Safari has also been observed silently resetting
  // playbackRate (and preservesPitch) once a freshly-loaded source actually
  // starts playing, independent of the `.src` assignment above — so the
  // single source of truth for "what speed should this element be at" is
  // always audio-store's `speed`, reasserted at both points the browser is
  // known to clobber it, rather than trusting whatever the element already
  // has.
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio) return;
    const applyRate = () => {
      setPlaybackRate(audio, useAudioStore.getState().speed);
    };
    audio.addEventListener("loadedmetadata", applyRate);
    audio.addEventListener("playing", applyRate);
    return () => {
      audio.removeEventListener("loadedmetadata", applyRate);
      audio.removeEventListener("playing", applyRate);
    };
  }, []);

  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || !isNarrating) return;
    // Same revert-on-rejection as the src-swap effect above — without it,
    // a rejected play() (iOS in particular) leaves the store reporting
    // "playing" while the element stays silent, so the play/pause icon and
    // the lock-screen state both lie until the user retries the gesture.
    if (audioPlaying) audio.play().catch(() => useAudioStore.getState().pause());
    else audio.pause();
  }, [isNarrating, audioPlaying]);

  // The word being read, worked out here and nowhere else: from the element's
  // own time, against the words of the clip it is actually playing (matched
  // by src). Reading the store's time against the store's words instead
  // flashed the previous passage's first word at every switch: the time
  // resets to 0 at once, while the old words stay until the next clip's
  // arrive — and a room speaker broadcast that flash to every listener.
  const liveClipRef = useRef<{ src: string | undefined; words: KaraokeWord[] }>({ src: undefined, words: [] });
  useEffect(() => {
    liveClipRef.current = { src: live.src, words: live.words };
  }, [live.src, live.words]);
  const publishWord = useCallback((audio: HTMLAudioElement) => {
    const { src, words } = liveClipRef.current;
    if (!src || audio.src !== src || words.length === 0) return;
    const word = words[activeWordIndex(words, audio.currentTime * 1000)];
    const current = useNarrationStore.getState().currentWord;
    if (current?.passageId === word.passageId && current.index === word.index) return;
    useNarrationStore.setState({ currentWord: { passageId: word.passageId, index: word.index } });
  }, []);

  // Keeps the shared playback clock in sync with the real element as it
  // plays.
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || !isNarrating) return;
    const onTimeUpdate = () => {
      useAudioStore.getState().seekTo(audio.currentTime * 1000);
      publishWord(audio);
      // Drives the lock-screen/Control Center scrub bar and elapsed-time
      // display — without it the OS media UI still shows play/pause but no
      // progress, since it has no other way to know where in the track the
      // real element is.
      if (typeof navigator !== "undefined" && "mediaSession" in navigator && activeDurationMs > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: activeDurationMs / 1000,
            playbackRate: audio.playbackRate,
            position: audio.currentTime,
          });
        } catch {
          // Safari throws if position momentarily exceeds duration (e.g.
          // right at track-end, just before an advance effect swaps in the
          // next source) — harmless to skip that one update.
        }
      }
    };
    audio.addEventListener("timeupdate", onTimeUpdate);
    return () => audio.removeEventListener("timeupdate", onTimeUpdate);
  }, [isNarrating, activeDurationMs, publishWord]);

  // Lock-screen / Control Center / Bluetooth-headset controls — the same
  // surface a podcast app gets, including while the screen is locked or the
  // PWA is backgrounded. iOS Safari only shows any of this once
  // `navigator.mediaSession.metadata` is set on the tab actually driving the
  // real <audio> element, which is always this one (see the module doc
  // comment above on why there's exactly one).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!book) {
      navigator.mediaSession.metadata = null;
      return;
    }
    // Podcast-app convention: the chapter is the "episode" (title), the
    // book is the "show" (artist) — matches how Apple Podcasts/Spotify
    // split a two-line lock-screen label, and puts the book title on
    // screen right alongside the chapter rather than only the author.
    const title = audioSection?.title ?? book.metadata.title;
    const artist = book.metadata.title;
    const album = book.metadata.author;
    // Set immediately, artwork-less — so title/artist/album show up (and
    // stay showing) even if the artwork fetch below is slow or fails
    // outright, rather than every field waiting on it.
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album });

    // WebKit's lock-screen artwork is well-documented (Safari 16.1+) as
    // only reliably rendering a SQUARE image — a non-square one (our
    // covers are ~2:3 portrait) renders as a blank/grey box instead of
    // being cropped or letterboxed automatically. Confirmed on-device
    // (iOS 16.7.16): that same bug window also caps out at small (128px)
    // artwork — anything bigger renders blank there, while 17.1+/18
    // handles large (512px) artwork fine. Rendering both onto letterboxed
    // squares (object-fit: contain, not cover — a hard center-crop was
    // chopping off a cover's title/author text near its top/bottom edges)
    // and listing both sizes lets a modern device pick the sharp one while
    // this exact older bug window still gets a working, if softer, image.
    let cancelled = false;
    const objectUrls: string[] = [];
    const squareLetterboxBlob = (img: HTMLImageElement, size: number): Promise<Blob | null> =>
      new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, size, size);
        const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
        canvas.toBlob(resolve, "image/jpeg", 0.92);
      });
    const cover = book.metadata.cover;
    if (cover) (async () => {
      let sourceUrl: string;
      try {
        const res = await fetch(cover);
        const blob = await res.blob();
        sourceUrl = URL.createObjectURL(blob);
      } catch {
        return; // Offline/CORS-blocked fetch — no artwork this round, title/artist/album above still stand.
      }
      if (cancelled) {
        URL.revokeObjectURL(sourceUrl);
        return;
      }
      const img = new Image();
      img.onload = async () => {
        URL.revokeObjectURL(sourceUrl);
        if (cancelled) return;
        const [small, large] = await Promise.all([squareLetterboxBlob(img, 128), squareLetterboxBlob(img, 512)]);
        if (cancelled || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
        const artwork = [
          small && { blob: small, sizes: "128x128" },
          large && { blob: large, sizes: "512x512" },
        ]
          .filter((entry): entry is { blob: Blob; sizes: string } => Boolean(entry))
          .map(({ blob, sizes }) => {
            const src = URL.createObjectURL(blob);
            objectUrls.push(src);
            return { src, sizes, type: "image/jpeg" };
          });
        if (artwork.length === 0) return;
        navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album, artwork });
      };
      img.src = sourceUrl;
    })();
    return () => {
      cancelled = true;
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [book, audioSection]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = !book ? "none" : audioPlaying ? "playing" : "paused";
  }, [book, audioPlaying]);

  // Explicit seeks (resume, click-to-play, scrub) need to move the real
  // element, not just the store's cached position.
  const seekAudio = useCallback((ms: number) => {
    const clamped = Math.max(0, ms);
    if (audioElRef.current) audioElRef.current.currentTime = clamped / 1000;
    useAudioStore.getState().seekTo(clamped);
  }, []);

  // On the audio element's real 'ended' event: the next passage in the
  // book's flat spine-order sequence — narrationIndex.next transparently
  // crosses a passage or section boundary exactly the same way it crosses
  // a chunk boundary inside one long passage, so there is no separate
  // section-advance branch here to fall out of sync with the rest of this
  // file (see the module doc comment on why that symmetry is the point).
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || !narrationIndex || !target) return;
    const onEnded = () => requestTarget(narrationIndex.next(target));
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [narrationIndex, target, requestTarget]);

  // Persists resume position as playback advances (reader-issues #2).
  useEffect(() => {
    if (!book || !materialId || !isNarrating || !audioSection || !currentPlayingPassageId) return;
    const passageIndex = audioSection.passages.findIndex((p) => p.id === currentPlayingPassageId);
    if (passageIndex >= 0) persistListenPosition(audioSection.id, passageIndex, audioCurrentTimeMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id, materialId, isNarrating, currentPlayingPassageId, audioSection?.id]);

  // Click-a-passage-to-narrate-from-there — a no-op only when the passage
  // itself has nothing narratable at all (an image, a table, ...). Starts at
  // the passage's first chunk, or, given a word ("listen from here" on a
  // selection), at the chunk holding it, then seeks to that word once the
  // clip is in (pendingWordSeekRef).
  const pendingWordSeekRef = useRef<{ passageId: string; chunkIndex: number; wordIndex: number } | undefined>(undefined);
  const seekToPassageForListening = useCallback(
    (sectionId: string, passageId: string, wordIndex?: number) => {
      const passage = passageById(passageId);
      if (!passage || !hasNarratableText(passage)) return;
      const offsets = chunkWordOffsets(passage);
      const chunkIndex = wordIndex === undefined ? 0 : Math.max(0, offsets.findLastIndex((o) => o <= wordIndex));
      requestTarget({ sectionId, passageId, chunkIndex }, { explicit: true });
      pendingWordSeekRef.current = wordIndex ? { passageId, chunkIndex, wordIndex } : undefined;
      useAudioStore.getState().play();
    },
    [passageById, requestTarget]
  );
  useEffect(() => {
    const pending = pendingWordSeekRef.current;
    if (!pending || live.status !== "ready" || !activeSrc) return;
    if (target?.passageId !== pending.passageId || target.chunkIndex !== pending.chunkIndex) {
      pendingWordSeekRef.current = undefined; // moved on before it loaded
      return;
    }
    pendingWordSeekRef.current = undefined;
    const word = live.words.find((w) => w.index >= pending.wordIndex);
    if (word) seekAudio(word.startMs);
  }, [live.status, live.words, activeSrc, target, seekAudio]);

  // A paragraph can be selected before this engine has switched over to its
  // book. Consume that one-shot intent only once the real passage index is
  // available, so it never briefly starts at the saved/default position.
  useEffect(() => {
    if (!startAtPassage || startAtPassage.bookId !== book?.id) return;
    const passage = passageById(startAtPassage.passageId);
    if (!passage || !hasNarratableText(passage)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consumes an external one-shot playback command.
    seekToPassageForListening(startAtPassage.sectionId, startAtPassage.passageId, startAtPassage.wordIndex);
    useAudioStore.getState().clearStartAtPassage();
  }, [book?.id, passageById, seekToPassageForListening, startAtPassage]);

  // Chapter-skip (player's prev/next-chapter buttons, not the ±15s seek) —
  // jumps narration to the adjacent spine section's first narratable
  // passage (typically its heading, but whatever that section's first
  // narratable content actually is). A section counts as skippable if it
  // has anything narratable at all — in practice, every real section.
  const sectionHasNarration = useCallback(
    (sectionId: string | undefined) => {
      const section = sectionId ? sectionsById.get(sectionId) : undefined;
      return Boolean(section?.passages.some(hasNarratableText));
    },
    [sectionsById]
  );
  const canSkipToPrevSection = sectionHasNarration(book?.spine[audioIndex - 1]);
  const canSkipToNextSection = sectionHasNarration(book?.spine[audioIndex + 1]);
  // The one jump primitive behind every "go narrate this other section"
  // entry point — the chapter-skip buttons (via skipSection below) and
  // ChaptersDrawer's own row clicks while in listen mode both just need to
  // name a target section and land here.
  const jumpToSection = useCallback(
    (targetId: string) => {
      if (!narrationIndex) return;
      const next = narrationIndex.firstOf(targetId);
      if (!next) return;
      requestTarget(next, { explicit: true });
      useAudioStore.getState().play();
    },
    [narrationIndex, requestTarget]
  );
  const skipSection = useCallback(
    (direction: -1 | 1) => {
      const targetId = book?.spine[audioIndex + direction];
      if (targetId) jumpToSection(targetId);
    },
    [book, audioIndex, jumpToSection]
  );
  const skipToPrevSection = useCallback(() => skipSection(-1), [skipSection]);
  const skipToNextSection = useCallback(() => skipSection(1), [skipSection]);

  // The other half of Media Session support (metadata/playbackState are set
  // above, near where audioSection/audioPlaying are already in scope) —
  // these are the actual lock-screen/Control Center/headset button
  // handlers, registered here since they need seekAudio/skipToPrevSection/
  // skipToNextSection, all defined above this point.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => useAudioStore.getState().play());
    ms.setActionHandler("pause", () => useAudioStore.getState().pause());
    // 15s, matching AudioPlayer's own back15Btn/forward15Btn — not the
    // browser-suggested 10s default — so a lock-screen skip lands on
    // exactly the same offset the in-app buttons use. details.seekOffset
    // (seconds) is only present when the OS itself specifies one.
    ms.setActionHandler("seekbackward", (details) => {
      seekAudio(useAudioStore.getState().currentTimeMs - (details.seekOffset ?? 15) * 1000);
    });
    ms.setActionHandler("seekforward", (details) => {
      seekAudio(useAudioStore.getState().currentTimeMs + (details.seekOffset ?? 15) * 1000);
    });
    ms.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) seekAudio(details.seekTime * 1000);
    });
    // Chapter skip (same as skipPrevBtn/skipNextBtn in AudioPlayer.tsx),
    // not a passage nudge.
    ms.setActionHandler("previoustrack", skipToPrevSection);
    ms.setActionHandler("nexttrack", skipToNextSection);

    return () => {
      ms.setActionHandler("play", null);
      ms.setActionHandler("pause", null);
      ms.setActionHandler("seekbackward", null);
      ms.setActionHandler("seekforward", null);
      ms.setActionHandler("seekto", null);
      ms.setActionHandler("previoustrack", null);
      ms.setActionHandler("nexttrack", null);
    };
  }, [seekAudio, skipToPrevSection, skipToNextSection]);

  const handleSeek = useCallback((ms: number) => seekAudio(ms), [seekAudio]);

  useEffect(() => {
    useNarrationStore.setState({
      audioSection,
      currentPlayingPassageId,
      audioIndex,
      canSkipToPrevSection,
      canSkipToNextSection,
      isBuffering,
      explicitJumpSeq,
    });
  }, [
    audioSection,
    currentPlayingPassageId,
    audioIndex,
    canSkipToPrevSection,
    canSkipToNextSection,
    explicitJumpSeq,
    isBuffering,
  ]);

  useEffect(() => {
    useNarrationStore.setState({
      seekToPassageForListening,
      skipToPrevSection,
      skipToNextSection,
      jumpToSection,
      handleSeek,
    });
  }, [seekToPassageForListening, skipToPrevSection, skipToNextSection, jumpToSection, handleSeek]);

  return null;
}
