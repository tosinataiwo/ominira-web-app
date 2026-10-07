"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { isIOSDevice } from "@/lib/pwa/platform";
import { useInstallBannerStore } from "@/stores/install-banner-store";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallPlatform = "ios" | "other";

function detectPlatform(): InstallPlatform {
  return isIOSDevice() ? "ios" : "other";
}

function detectRequiresSafariRedirect(): boolean {
  // Every iOS browser — Chrome, Firefox, Edge, Opera, an in-app webview —
  // is still WebKit under the hood, but iOS only exposes "Add to Home
  // Screen" as a real install path through Safari itself. CriOS/FxiOS/
  // EdgiOS/OPiOS are the standard UA tokens those browsers identify
  // themselves with (a "wv" token, the usual Android in-app-browser tell,
  // doesn't exist on iOS — nothing reliably flags in-app webviews there).
  return isIOSDevice() && /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
}

function detectStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Legacy iOS Safari flag — iOS never fires the standard display-mode
    // media query change reliably, so this is still the only signal there.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// Neither of these ever changes after the page loads, so `subscribe` has
// nothing to listen for — they're read via useSyncExternalStore purely so
// the browser-only read is deferred out of the render body (server snapshot
// "other"/false, real value swapped in on the client) without the
// mount-then-setState effect shape React's purity rules flag.
const noopSubscribe = () => () => {};

function usePlatform(): InstallPlatform {
  return useSyncExternalStore(noopSubscribe, detectPlatform, () => "other");
}

function useRequiresSafariRedirect(): boolean {
  return useSyncExternalStore(noopSubscribe, detectRequiresSafariRedirect, () => false);
}

function useIsStandalone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(display-mode: standalone)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    detectStandalone,
    () => false
  );
}

/**
 * Wraps the `beforeinstallprompt` capture + display-mode detection a real
 * "install this PWA" UI needs. `canPrompt` reflects whether the browser
 * actually handed us a native install dialog to trigger (Chrome/Edge-family
 * on Android) — deliberately not UA-derived, since a captured event is the
 * only reliable signal that the native prompt exists. `platform` is UA-based
 * and only used to pick which *manual* instructions to show when no native
 * prompt is available.
 */
export function useInstallPrompt() {
  const platform = usePlatform();
  const requiresSafariRedirect = useRequiresSafariRedirect();
  const isStandalone = useIsStandalone();
  const hasEverBeenStandalone = useInstallBannerStore((s) => s.hasEverBeenStandalone);
  const markEverInstalled = useInstallBannerStore((s) => s.markEverInstalled);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  // Remembered permanently (install-banner-store) rather than trusted only
  // live: display-mode is only ever "standalone" *while actually running
  // installed* — a reader who's installed the app but happens to be looking
  // at a stray browser tab would otherwise see install UI again.
  useEffect(() => {
    if (isStandalone) markEverInstalled();
  }, [isStandalone, markEverInstalled]);

  const promptInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // A captured prompt can only be used once.
    setDeferredPrompt(null);
  };

  return {
    canPrompt: deferredPrompt !== null,
    promptInstall,
    platform,
    requiresSafariRedirect,
    isStandalone,
    // The one value install UI should actually gate on — covers both "this
    // tab is currently running installed" and "we've seen this device
    // installed before, even if not in this tab."
    isInstalled: isStandalone || hasEverBeenStandalone,
  };
}
