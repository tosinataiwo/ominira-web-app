import type { Metadata, Viewport } from "next";
import { Source_Serif_4, Manrope } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";
import ServiceWorkerRegistration from "./ServiceWorkerRegistration";
import TouchActiveState from "./components/pwa/TouchActiveState";
import AppSplashScreen from "./components/pwa/AppSplashScreen";
import NowPlayingBar from "./components/NowPlayingBar";
import RoomLayer from "./components/room/RoomLayer";
import Toaster from "./components/shared/Toaster";
import ThemeProvider from "./components/ThemeProvider";
import QueryProvider from "./components/QueryProvider";
import NarrationEngine from "@/lib/audio/NarrationEngine";
import { PLATFORM_NAME, PLATFORM_URL } from "@/lib/config/platform";
import { BOOT_SCRIPT } from "@/lib/pwa/boot";
import { ICON_VERSION } from "@/lib/config/brand-assets";

// opsz: next/font drops the optical-size axis unless asked, which flattens
// headings to the 14pt text cut. Italic is loaded so it isn't synthesised.
// latin-ext carries ṣ ṅ ɓ ɗ ƙ ƴ; vietnamese carries ẹ ọ ị ụ and the stacked
// tone marks Yoruba/Igbo need.
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin", "latin-ext", "vietnamese"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

export const metadata: Metadata = {
  metadataBase: new URL(PLATFORM_URL),
  title: { default: PLATFORM_NAME, template: `%s — ${PLATFORM_NAME}` },
  description: "Arise for Freedom",
  applicationName: PLATFORM_NAME,
  manifest: "/manifest.json",
  // One favicon set for both colour schemes: its cream tile frames the mark
  // on light and dark tab bars alike. iOS reads apple-touch-icon once, when
  // the reader adds the app to their home screen.
  icons: {
    icon: [16, 32, 48].map((size) => ({
      url: `/icons/favicon-${size}x${size}.png?v=${ICON_VERSION}`,
      sizes: `${size}x${size}`,
      type: "image/png",
    })),
    apple: [152, 180].map((size) => ({
      url: `/icons/apple-touch-icon-${size}x${size}.png?v=${ICON_VERSION}`,
      sizes: `${size}x${size}`,
    })),
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: PLATFORM_NAME,
  },
  openGraph: {
    siteName: PLATFORM_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
  other: {
    // Next only emits the standardized `mobile-web-app-capable` tag; older
    // iOS Safari (pre-17.4) only honors this legacy Apple-prefixed one for
    // standalone (no-browser-chrome) launch from the home screen.
    "apple-mobile-web-app-capable": "yes",
  },
};

// No themeColor here: the right value depends on the reader's persisted
// theme (and whether the launch splash is up), which only the client knows —
// lib/pwa/boot.ts's inline script writes the theme-color meta before first
// paint, and ThemeProvider/AppSplashScreen keep it in step after.
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  /** The @modal parallel slot (app/@modal) — null on every route except an
   * intercepted (.)read/[slug] navigation (app/@modal/(.)read/[slug]),
   * where it renders the reader as a full-viewport overlay on top of
   * `children` instead of replacing it. See ReaderModal's own doc comment. */
  modal: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // Some browser extensions (password managers, form-fill tools, etc.)
      // inject their own attributes onto <html> before React hydrates —
      // e.g. a stray data-qb-installed. That's an external DOM mutation,
      // not a real client/server mismatch in this app's own markup, so it's
      // suppressed here rather than chased as a bug (per React's own
      // hydration-mismatch guidance).
      suppressHydrationWarning
      className={`${sourceSerif.variable} ${manrope.variable} h-full antialiased`}
    >
      <head>
        {/* Parser-blocking on purpose: sets data-reader-theme (and
            data-splash) on <html> before the first frame. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        {/* ::highlight() is rejected by the CSS pipeline, so it lives here.
            Paints the narrated word for DOCX/web articles
            (useArticleNarration); only colours and text-shadow apply. */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              "::highlight(om-narrating-word){background-color:var(--reader-active-word-bg);color:var(--reader-active-word-text);text-shadow:0 0 0.3px currentColor}",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <QueryProvider>
          <ThemeProvider>
            <AppSplashScreen />
            {children}
          </ThemeProvider>
          {modal}
          <ServiceWorkerRegistration />
          <TouchActiveState />
          <NarrationEngine />
          <NowPlayingBar />
          <RoomLayer />
          <Toaster />
          {/* `mode` is explicit (rather than relying on the "auto" default)
           * so a local `bun run dev` never reports as production even if
           * NODE_ENV gets overridden by tooling — only a real production
           * build sends events; every other mode just console-logs them. */}
          <Analytics
            mode={
              process.env.NODE_ENV === "production"
                ? "production"
                : "development"
            }
          />
        </QueryProvider>
      </body>
    </html>
  );
}
