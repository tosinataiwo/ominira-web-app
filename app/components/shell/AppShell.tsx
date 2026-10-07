"use client";

import type { ReactNode } from "react";
import AppSidebar from "./AppSidebar";
import AppBottomNav from "./AppBottomNav";
import { useDockedHeight } from "@/app/components/useBottomDock";
import { useLayoutStore } from "@/stores/layout-store";

/**
 * Shared chrome for every page under app/(app) — reserves space for the
 * desktop sidebar and mobile bottom nav once here rather than in every page.
 *
 * Bottom padding used to be a static pb-20 shell:pb-0 — enough to clear
 * AppBottomNav alone, but oblivious to NowPlayingBar (also fixed to the
 * bottom, and also shown on desktop, where shell:pb-0 zeroed the padding
 * out entirely). Scrolling any page to the end while a book was loaded for
 * listening left its last bit sitting behind the player. Same
 * measure-and-store trick bottomNavHeight/playerHeight already use elsewhere
 * (HomeInstallBanner, AppBottomNav's own offset) — real rendered heights,
 * summed, rather than a guessed constant.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const dockedHeight = useDockedHeight();
  const bottomNavHeight = useLayoutStore((s) => s.bottomNavHeight);
  const topBarHeight = useLayoutStore((s) => s.topBarHeight);
  return (
    <div className="min-h-screen" style={{ background: "var(--reader-bg)" }}>
      <AppSidebar />

      <div
        className="shell:pl-[var(--app-sidebar-w)]"
        style={{
          paddingTop: `calc(env(safe-area-inset-top) + ${topBarHeight}px)`,
          paddingBottom: bottomNavHeight + dockedHeight,
        }}
      >
        <main className="mx-auto max-w-5xl px-5 py-2 shell:px-10">{children}</main>
      </div>

      <AppBottomNav />
    </div>
  );
}
