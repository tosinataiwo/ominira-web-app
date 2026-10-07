import { useState } from "react";
import type { InstallPlatform } from "@/lib/pwa/useInstallPrompt";

export type InstallStep = {
  label: string;
  /** CDN or local URL for the annotated screenshot for this step. Left
   * blank, a captioned placeholder is shown instead. */
  screenshot: string;
  /** What the step should depict — the placeholder caption when
   * `screenshot` isn't set, and the image's alt text once it is. */
  placeholder: string;
};

// Copy and step ordering match the Claude Design "Instant Reference Card"
// concept (PWA Install UX Concepts.dc.html, option 1b) verbatim. Heights
// mirror that design's own image-slot sizing per step.
export const IOS_INSTALL_STEPS: InstallStep[] = [
  {
    label: "Tap the Share icon",
    screenshot:
      "https://zpkykgmtqzaglxbrwzah.supabase.co/storage/v1/object/public/public-cdn/pwa-1.png",
    placeholder: "Screenshot: Safari toolbar, Share icon circled",
  },
  {
    label: "Scroll down, tap “Add to Home Screen”",
    screenshot:
      "https://zpkykgmtqzaglxbrwzah.supabase.co/storage/v1/object/public/public-cdn/pwa-2.png",
    placeholder: "Screenshot: Share sheet, Add to Home Screen row highlighted",
  },
  {
    label: "Tap “Add” in the top right",
    screenshot:
      "https://zpkykgmtqzaglxbrwzah.supabase.co/storage/v1/object/public/public-cdn/pwa-3.png",
    placeholder: "Screenshot: confirmation dialog, Add button circled",
  },
];

// Sourced device screenshots, annotated to match the design's callout style.
export const ANDROID_INSTALL_STEPS: InstallStep[] = [
  {
    label: "Tap the menu (⋮)",
    screenshot: "/images/pwa/android-step1-v2.png",
    placeholder: "Browser toolbar, three-dot menu circled",
  },
  {
    label: "Tap “Install app”",
    screenshot: "/images/pwa/android-step2-v2.png",
    placeholder: "Menu list, Install app row highlighted",
  },
  {
    label: "Tap “Install” to confirm",
    screenshot: "/images/pwa/android-step3-v3.png",
    placeholder: "Install confirmation dialog, Install button circled",
  },
];

const STEP_HEIGHTS = [80, 190, 110];

/**
 * `bordered` gives the image its own rounded border — used in the iOS list,
 * where nothing else frames it. The Android per-step card already supplies
 * a rounded border of its own, so its images render plain and rely on the
 * card's `overflow-hidden` to clip corners — a second nested border/radius
 * there just doubled up the frame for no reason.
 */
function StepImage({ step, height, bordered = true }: { step: InstallStep; height: number; bordered?: boolean }) {
  if (step.screenshot) {
    // Natural aspect ratio, not a forced `height` — the sourced screenshots
    // vary a lot in shape (the menu step is a short wide strip, the dialog
    // steps are much taller), so cropping to match `height` would cut real
    // content (e.g. slice off the Install button) rather than just frame it.
    return (
      <img
        src={step.screenshot}
        alt={step.placeholder}
        className={`w-full ${bordered ? "rounded-lg border border-sand-200" : ""}`}
      />
    );
  }
  return (
    <div
      style={{ height }}
      className={`flex w-full items-center justify-center bg-sand-50 px-3 text-center text-[11px] leading-snug text-sand-400 ${
        bordered ? "rounded-lg border border-dashed border-sand-300" : ""
      }`}
    >
      {step.placeholder}
    </div>
  );
}

/**
 * The tab switcher + per-platform steps from the Claude Design "Instant
 * Reference Card" concept (option 1b) — bare content only, no outer card
 * frame or hint strip of its own. InstallModal is the one caller today and
 * already supplies that chrome (header, border, background) as the modal
 * panel itself, so a second nested border/background here would just double
 * up the frame the way InstallReferenceCard's own step images used to (see
 * StepImage's `bordered` comment above).
 *
 * Both platforms' steps are always fully written out behind the tab switch
 * — a reader picks the tab themselves rather than trusting UA-sniffing to
 * have guessed right for them. `platform` only picks which tab starts
 * active — "other" is labeled "Chrome / Android" rather than the source
 * design's "Android (manual)" since that bucket is genuinely anything-not-
 * iOS (desktop Safari/Chrome included, see useInstallPrompt's binary
 * InstallPlatform), and the three-dot-menu flow is accurate for Chrome/Edge
 * on either.
 *
 * `dimmed` is for the iOS-wrong-browser case: rather than showing (and
 * needlessly duplicating) the full steps, it collapses to just the tab pill
 * plus a one-line "steps shown here once you're in Safari" note. The caller
 * shows its own "open in Safari" messaging above this.
 */
export default function InstallReferenceCard({
  platform,
  dimmed = false,
}: {
  platform: InstallPlatform;
  dimmed?: boolean;
}) {
  const [tab, setTab] = useState<InstallPlatform>(platform);
  const steps = tab === "ios" ? IOS_INSTALL_STEPS : ANDROID_INSTALL_STEPS;

  return (
    <div className={`flex flex-col gap-3 ${dimmed ? "pointer-events-none opacity-35" : ""}`}>
      <div className="flex w-fit gap-1 rounded-sm bg-brand-50 p-[3px]">
        {(["ios", "other"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`cursor-pointer rounded-sm border-none px-4 py-1.5 text-[11px] font-bold transition-colors ${
              tab === key ? "bg-brand-500 text-white" : "bg-transparent text-black/50 hover:text-sand-950"
            }`}
          >
            {key === "ios" ? "iOS (Safari)" : "Android (Chrome)"}
          </button>
        ))}
      </div>

      {dimmed ? (
        <p className="m-0 text-[11.5px] text-black/50">Steps 1–3 shown here once you&apos;re in Safari.</p>
      ) : tab === "other" ? (
        // "Wizard — Android manual path (no native prompt)", concept 1a,
        // reproduced as its own per-step card — a step-frame (bordered,
        // rounded-xl, its own header row) plus a dot-row marking this
        // step's position among the three. `overflow-hidden` on the card
        // does the corner-clipping, so the image inside stays unbordered
        // (see StepImage's `bordered` prop) instead of nesting a second
        // rounded frame inside the first.
        <div className="flex flex-col gap-3">
          {steps.map((step, i) => (
            <div key={step.label} className="flex flex-col gap-2.5 overflow-hidden rounded-sm border border-sand-200 bg-white p-3.5">
              <div className="flex items-center gap-2">
                <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-sm bg-sand-950 text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="text-[12px] font-bold text-sand-950">{step.label}</span>
              </div>
              <StepImage step={step} height={STEP_HEIGHTS[i]} bordered={false} />
            </div>
          ))}
        </div>
      ) : (
        <ol className="m-0 flex flex-col gap-5 pl-0">
          {steps.map((step, i) => (
            <li key={step.label} className="flex items-start gap-2.5">
              <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-sm bg-sand-950 text-[11px] font-bold text-white">
                {i + 1}
              </span>
              <div className="flex flex-1 flex-col gap-1.5">
                <span className="text-[12px] font-bold text-sand-950">{step.label}</span>
                <StepImage step={step} height={STEP_HEIGHTS[i]} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
