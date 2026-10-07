"use client";

import { usePathname } from "next/navigation";
import { useAudioStore } from "@/stores/audio-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useReaderOverlayStore } from "@/stores/reader-overlay-store";
import { useReaderStore } from "@/stores/reader-store";

// Matches both reader routes (app/read/[slug], the canonical/shareable URL,
// and app/reader/[slug], the soft-navigable one ReaderLink actually lands
// on — see that component's own doc comment) — deliberately with the
// trailing slash: a bare `startsWith("/read")` also matches `/reading`
// (app/(app)/reading/page.tsx, the "Continue reading" library page), which
// would wrongly hide the sidebar offset and bottom-nav clearance while just
// browsing the library.
function isReaderPath(pathname: string): boolean {
  return pathname.startsWith("/read/") || pathname.startsWith("/reader/");
}

/**
 * Where a bar fixed to the bottom of the app shell sits (NowPlayingBar,
 * RoomMiniPlayer), so every such bar clears the same chrome.
 *
 * `theme`: --reader-surface/--reader-border/etc. (globals.css) are scoped to
 * [data-reader-theme] rather than :root, since only the reader itself is
 * meant to follow the light/dark toggle. A bar in the root layout sits
 * outside Reader's theme-scoped tree, so it sets the attribute itself, or
 * those variables resolve to nothing.
 *
 * Sidebar: every route except the reader has a persistent left sidebar
 * (app/components/shell/AppSidebar.tsx) at the 860px breakpoint — full width
 * would run the bar underneath it. pathname alone can't tell the standalone
 * /read page (no sidebar) apart from ReaderModal open over a sidebar-having
 * page: an intercepted (.)read/[slug] navigation moves the URL to
 * /read/[slug] either way. reader-overlay-store's `open` (set by ReaderModal)
 * is the source of truth for that.
 *
 * Bottom: floats above AppBottomNav (the mobile tab bar). In the reader,
 * AppBottomNav is unmounted or covered, and bottomNavHeight can go stale
 * there (unmounting doesn't reset it), so it's ignored while the reader is
 * on screen.
 *
 * Reader panel: the reader's desktop notes panel is a plain flex sibling
 * with no elevation of its own, so the bar pulls in to clear it.
 */
export function useBottomDock() {
  const pathname = usePathname();
  const overlayOpen = useReaderOverlayStore((s) => s.open);
  const bottomNavHeight = useLayoutStore((s) => s.bottomNavHeight);
  const readerPanelOpen = useLayoutStore((s) => s.readerPanelOpen);
  const theme = useReaderStore((s) => s.theme);

  const readerActive = isReaderPath(pathname);
  const hasSidebar = !readerActive || overlayOpen;
  const className = `fixed left-0 right-0 z-50 ${hasSidebar ? "shell:left-[var(--app-sidebar-w)]" : ""} ${
    readerActive && readerPanelOpen ? "shell:right-95" : ""
  }`;
  return { theme, className, bottom: readerActive ? 0 : bottomNavHeight };
}

/** The narration bar's height while it's showing — where a bar stacked
 * above it starts. */
export function useNarrationBarHeight(): number {
  return useAudioStore((s) => (s.book !== null ? s.playerHeight : 0));
}

/** Everything docked at the bottom above the nav (the narration bar and the
 * room player), which content and floating controls keep clear of. */
export function useDockedHeight(): number {
  const roomPlayerHeight = useLayoutStore((s) => s.roomPlayerHeight);
  return useNarrationBarHeight() + roomPlayerHeight;
}
