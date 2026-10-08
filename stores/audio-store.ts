import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { NarrationDocument } from "@/lib/audio/narrationDocument";
import { DEFAULT_VOICE_ID } from "@/lib/audio/voices";

/**
 * Playback state lives outside the Reader component tree on purpose: the
 * product spec requires narration to keep playing across navigation
 * (including back to the library), podcast-style. `book` is the single
 * "now playing" slot — the full document, not just an id/slug, since the
 * global narration engine (lib/audio/NarrationEngine.tsx, mounted once in
 * the root layout) needs spine/sections/audio tracks regardless of which
 * route is currently mounted. Opening a new book always replaces whatever
 * was playing — there's only ever one now-playing slot, same as any other
 * single-player audio app.
 */
type AudioState = {
  isPlaying: boolean;
  currentTimeMs: number;
  /** Which Edge TTS voice (lib/audio/voices.ts) live narration speaks in —
   * a reader-wide preference, same footing as `speed`, not tied to any one
   * book. */
  voice: string;
  speed: number;
  /** Real rendered height of the root-level player bar, in px — Reader
   * reads this to reserve bottom space and to position the "back to
   * narration" nudge, without owning the player's DOM itself anymore. */
  playerHeight: number;
  book: NarrationDocument | null;
  /** The same book's real `materials.id` (UUID) — kept alongside `book`
   * rather than derived from it, since `book.id` is ingestion's own
   * slug-like internal id (api-spec.md: deliberately distinct from
   * materialId). NarrationEngine reads/writes reading-position-store by
   * this, not `book.id`. */
  materialId: string | null;
  /** A paragraph picked before the narration engine has received this book. */
  startAtPassage: { bookId: string; sectionId: string; passageId: string; wordIndex?: number } | null;

  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (ms: number) => void;
  setVoice: (voice: string) => void;
  setSpeed: (speed: number) => void;
  setPlayerHeight: (px: number) => void;
  /** Starts (or switches) listen mode to this book and begins playback —
   * the engine's own resume-position effect immediately reconciles
   * currentTimeMs against whatever was last saved for it. */
  openBook: (book: NarrationDocument, materialId: string) => void;
  openBookAtPassage: (
    book: NarrationDocument,
    materialId: string,
    sectionId: string,
    passageId: string,
    wordIndex?: number
  ) => void;
  clearStartAtPassage: () => void;
  /** Keeps `book` in sync as more of it arrives — Reader.tsx's own prose
   * loads progressively (see useProgressiveText's doc comment: every
   * section's structure is real from the start, but non-eager sections'
   * passage.text starts blank and backfills asynchronously). openBook is
   * called once, at listen-start, with whatever's loaded *then*; without
   * this, any section that finishes loading its real text *after* that —
   * which is the common case, since progressive loading is still running
   * in the background — would stay permanently blank as far as
   * NarrationEngine's narrationIndex is concerned, even though the reader
   * itself is already showing real prose for it. A no-op if `book` isn't
   * the one currently playing (stale call from a book the reader has since
   * navigated away from/closed listen mode for). */
  updateBookContent: (book: NarrationDocument) => void;
  /** Exits listen mode entirely — resume position is left untouched in
   * reading-position-store, so reopening the book later picks up where
   * playback left off instead of restarting. */
  closePlayer: () => void;
};

// Only `speed`/`voice` are persisted — every other field is session/
// playback state (the "now playing" slot itself, current position, etc.)
// that should never survive a reload. Both are preferences a reader
// expects to stick until changed again, defaulting back to 1x/the first
// African voice otherwise.
export const useAudioStore = create<AudioState>()(
  persist(
    (set) => ({
      isPlaying: false,
      currentTimeMs: 0,
      voice: DEFAULT_VOICE_ID,
      speed: 1,
      playerHeight: 0,
      book: null,
      materialId: null,
      startAtPassage: null,

      play: () => set({ isPlaying: true }),
      pause: () => set({ isPlaying: false }),
      toggle: () => set((s) => ({ isPlaying: !s.isPlaying })),
      seekTo: (ms) => set({ currentTimeMs: Math.max(0, ms) }),
      setVoice: (voice) => set({ voice }),
      setSpeed: (speed) => set({ speed }),
      setPlayerHeight: (playerHeight) => set({ playerHeight }),
      openBook: (book, materialId) => set({ book, materialId, currentTimeMs: 0, isPlaying: true }),
      openBookAtPassage: (book, materialId, sectionId, passageId, wordIndex) =>
        set({
          book,
          materialId,
          currentTimeMs: 0,
          isPlaying: true,
          startAtPassage: { bookId: book.id, sectionId, passageId, wordIndex },
        }),
      clearStartAtPassage: () => set({ startAtPassage: null }),
      updateBookContent: (book) => set((s) => (s.book && s.book.id === book.id ? { book } : {})),
      closePlayer: () => set({ book: null, materialId: null, isPlaying: false, startAtPassage: null }),
    }),
    {
      name: "ominira-audio-prefs",
      partialize: (state) => ({ speed: state.speed, voice: state.voice }),
    }
  )
);
