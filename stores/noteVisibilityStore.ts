import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { NoteVisibility } from "@/lib/api/types";

type NoteVisibilityState = {
  /** What a fresh compose surface (a brand-new note or reply — never an
   * edit, which starts from the note's own current visibility instead)
   * defaults its own toggle to. Public until a reader deliberately switches
   * to private at least once; from then on it stays whatever they last
   * left it at, across notes, across sessions, across devices this
   * persisted value doesn't sync to (this is per-device localStorage, not
   * a reader-account setting) — the point is just "don't make me re-flip
   * this every single time," not durability across a phone/laptop switch. */
  lastVisibility: NoteVisibility;
  setLastVisibility: (v: NoteVisibility) => void;
};

/** A composing preference — kept in its own tiny store rather than folded
 * into reader-store.ts, which holds only the theme.
 * No skipHydration/manual-rehydrate dance either — unlike theme (rendered
 * on first paint), nothing here is read before a reader has already
 * clicked into a composer, well after this store's had time to hydrate. */
export const useNoteVisibilityStore = create<NoteVisibilityState>()(
  persist(
    (set) => ({
      lastVisibility: "public",
      setLastVisibility: (v) => set({ lastVisibility: v }),
    }),
    { name: "ominira-note-visibility" }
  )
);
