import { create } from "zustand";

/**
 * Real rendered heights of persistent fixed chrome that other fixed
 * elements need to stack above — the same "measure it, store it, offset
 * against it" trick audio-store's playerHeight already does for
 * NowPlayingBar. Pure runtime layout state, not user data, so no persist
 * middleware: it's meaningless before the DOM exists and gets re-measured
 * on every mount anyway.
 */
type LayoutState = {
  /** AppBottomNav's own rendered height (mobile tab bar), in px. */
  bottomNavHeight: number;
  setBottomNavHeight: (px: number) => void;
  /**
   * Whether the reader's own notes/annotation-feed panel is currently open
   * at its desktop "side" width (Reader.tsx's `notesPanel || noteFeed.open`
   * — the same condition that drives its `shell:w-95`/`shell:w-0` toggle).
   * On mobile that panel is a `fixed` bottom sheet stacked above everything
   * (z-70), so it never needs this; on desktop it's a plain flex sibling
   * with no elevation of its own, so NowPlayingBar reads this to pull its
   * own right edge in (the same `w-95` width, so it can't drift out of
   * sync) and avoid running underneath it.
   */
  readerPanelOpen: boolean;
  setReaderPanelOpen: (open: boolean) => void;
  /** HomeInstallBanner's own rendered height, when it's showing (0
   * otherwise) — AppShell reads this to push page content down below it,
   * the same trick bottomNavHeight plays at the other edge. */
  topBarHeight: number;
  setTopBarHeight: (px: number) => void;
  /** RoomMiniPlayer's rendered height while in a room (0 otherwise); it
   * stacks above NowPlayingBar. Read through useDockedHeight. */
  roomPlayerHeight: number;
  setRoomPlayerHeight: (px: number) => void;
  /** The reader's chapter footer's height while it's showing (0 otherwise),
   * so RoomMiniPlayer floats above it rather than under it. */
  readerFooterHeight: number;
  setReaderFooterHeight: (px: number) => void;
};

export const useLayoutStore = create<LayoutState>((set) => ({
  bottomNavHeight: 0,
  setBottomNavHeight: (bottomNavHeight) => set({ bottomNavHeight }),
  readerPanelOpen: false,
  setReaderPanelOpen: (readerPanelOpen) => set({ readerPanelOpen }),
  topBarHeight: 0,
  setTopBarHeight: (topBarHeight) => set({ topBarHeight }),
  roomPlayerHeight: 0,
  setRoomPlayerHeight: (roomPlayerHeight) => set({ roomPlayerHeight }),
  readerFooterHeight: 0,
  setReaderFooterHeight: (readerFooterHeight) => set({ readerFooterHeight }),
}));
