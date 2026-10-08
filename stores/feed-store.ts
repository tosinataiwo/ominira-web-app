import { create } from "zustand";

/** The feed panel's tabs. "room" is the live room, offered only while
 * you're in the room on this book. */
export type FeedTab = "room" | "notes" | "highlights";

/**
 * Which book's feed panel is open, and on which tab. In a store rather than
 * the reader's own state because the room's mini-player lives in the app
 * shell: expanding it opens this panel on the Room tab. Per book, so another
 * book's reader never opens with it.
 */
type FeedState = {
  openFor: string | null;
  tab: FeedTab;
  open: (materialId: string, tab: FeedTab) => void;
  setTab: (tab: FeedTab) => void;
  close: () => void;
};

export const useFeedStore = create<FeedState>()((set) => ({
  openFor: null,
  tab: "notes",
  open: (openFor, tab) => set({ openFor, tab }),
  setTab: (tab) => set({ tab }),
  close: () => set({ openFor: null }),
}));
