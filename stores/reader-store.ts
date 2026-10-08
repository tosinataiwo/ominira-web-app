import type { CSSProperties } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { READER_PREFS_STORAGE_KEY } from "@/lib/pwa/boot";

/* ---- Typography — the one place that sets how book text looks ----------
 * Every text format (EPUB, DOCX, web articles) reads these. Tweak a value in
 * DEFAULT_TYPOGRAPHY and it changes everywhere. A future settings UI only
 * needs to call setTypography({ lineHeight: 1.8 }) etc.
 *
 * How it reaches the page: typographyStyle() turns the values into CSS
 * variables (--reader-font-size, --reader-line-height, …) on each reader's
 * root element, and the text inside reads those variables. */

export type FontFamily = "serif" | "sans" | "system";

export const FONT_FAMILIES: Record<FontFamily, string> = {
  serif: 'var(--font-source-serif), "Iowan Old Style", Georgia, serif',
  sans: 'var(--font-manrope), -apple-system, "Segoe UI", sans-serif',
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

export type Typography = {
  fontFamily: FontFamily;
  /** px, phones (under 768px wide) */
  fontSizeMobile: number;
  /** px, tablets and desktop */
  fontSizeDesktop: number;
  /** unitless multiple of the font size */
  lineHeight: number;
  /** px between paragraphs */
  paragraphSpacing: number;
  /** px, the widest the text column gets */
  maxWidth: number;
};

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontFamily: "serif",
  fontSizeMobile: 17,
  fontSizeDesktop: 18,
  lineHeight: 1.75,
  paragraphSpacing: 16,
  maxWidth: 740,
};

/** The typography as CSS variables, for a reader's root element (with the `reader-typography` class, globals.css). */
export function typographyStyle(t: Typography): CSSProperties {
  return {
    "--reader-font-family": FONT_FAMILIES[t.fontFamily],
    "--reader-font-size-mobile": `${t.fontSizeMobile}px`,
    "--reader-font-size-desktop": `${t.fontSizeDesktop}px`,
    "--reader-line-height": t.lineHeight,
    "--reader-paragraph-spacing": `${t.paragraphSpacing}px`,
    "--reader-max-width": `${t.maxWidth}px`,
  } as CSSProperties;
}

/* ---- Theme -------------------------------------------------------------
 * Light/dark. Follows the device until the reader picks one. <html> gets
 * data-reader-theme before first paint (lib/pwa/boot.ts) and ThemeProvider
 * keeps it in step; the --reader-* colours in globals.css cascade from it. */

export type Theme = "light" | "dark";

/** The device's colour scheme; light when it states none (or outside a browser). */
export function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

type ReaderState = {
  typography: Typography;
  setTypography: (patch: Partial<Typography>) => void;
  resetTypography: () => void;

  theme: Theme;
  /** True once the reader has picked a theme. Until then `theme` follows the device and isn't saved. */
  themeExplicit: boolean;
  /** The reader's own choice — saved, and stops following the device. */
  setTheme: (t: Theme) => void;
  /** The device's scheme changed — applied only while the reader hasn't chosen. */
  syncSystemTheme: (t: Theme) => void;
};

export const useReaderStore = create<ReaderState>()(
  persist(
    (set) => ({
      typography: DEFAULT_TYPOGRAPHY,
      setTypography: (patch) => set((s) => ({ typography: { ...s.typography, ...patch } })),
      resetTypography: () => set({ typography: DEFAULT_TYPOGRAPHY }),

      theme: "light",
      themeExplicit: false,
      setTheme: (theme) => set({ theme, themeExplicit: true }),
      syncSystemTheme: (theme) => set((s) => (s.themeExplicit ? {} : { theme })),
    }),
    {
      name: READER_PREFS_STORAGE_KEY,
      version: 7,
      // Only the theme is saved for now. Typography isn't, so edits to
      // DEFAULT_TYPOGRAPHY show up straight away; add it here once readers
      // can change it from the UI.
      partialize: (s) => (s.themeExplicit ? { theme: s.theme, themeExplicit: true } : {}),
      // Older saves held a different typography shape, now dropped. Same
      // rule as the boot script: a saved dark (incl. retired dark variants
      // like "carbon") was always a choice; a saved light only if flagged.
      migrate: (persisted) => {
        const s = (persisted ?? {}) as { theme?: string; themeExplicit?: boolean };
        const dark = /^(dark|carbon|black|winter|forest)$/.test(s.theme ?? "");
        return { theme: dark ? "dark" : "light", themeExplicit: dark || Boolean(s.themeExplicit) } as ReaderState;
      },
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<ReaderState>) };
        if (!merged.themeExplicit) merged.theme = systemTheme();
        return merged;
      },
      // localStorage can't be read during SSR; rehydrated after mount
      // (ThemeProvider, Reader) so server and first client render agree.
      skipHydration: true,
    }
  )
);

/** This reader's typography as CSS variables — spread onto a reader's root `style`. */
export function useTypographyStyle(): CSSProperties {
  return typographyStyle(useReaderStore((s) => s.typography));
}
