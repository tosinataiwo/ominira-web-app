"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/react";
import { PdfErrorCode, type PdfDocumentObject, type PdfEngine } from "@embedpdf/models";
import { DocumentManagerPluginPackage } from "@embedpdf/plugin-document-manager/react";
import { RenderLayer, RenderPluginPackage } from "@embedpdf/plugin-render/react";
import { Scroller, ScrollPluginPackage, useScroll, useScrollCapability } from "@embedpdf/plugin-scroll/react";
import type { PageLayout } from "@embedpdf/plugin-scroll";
import { TilingLayer, TilingPluginPackage } from "@embedpdf/plugin-tiling/react";
import { useViewportElement, Viewport, ViewportPluginPackage } from "@embedpdf/plugin-viewport/react";
import { ZoomGestureWrapper, ZoomMode, ZoomPluginPackage, useZoom } from "@embedpdf/plugin-zoom/react";
import { usePdfEngine } from "@/lib/pdf/pdfiumEngine";
import { formatDownloadProgress, PdfFetchError, type PdfDownload } from "@/lib/pdf/usePdfBytes";
import Loader from "@/app/components/Loader";
import { useReaderStore } from "@/stores/reader-store";
import type { Locator } from "@/lib/reader/locator";
import { useDocumentProgress } from "@/lib/reader/useDocumentProgress";
import { useDocumentKeyboard } from "@/lib/reader/useDocumentKeyboard";
import DocumentEndPanel from "./DocumentEndPanel";
import PdfPagerFooter from "./PdfPagerFooter";
import ReaderHeader from "./ReaderHeader";
import { createPdfSurface, pdfBlockId, pdfPageIndexOf, pdfRangeRects, PDF_PAGE_ATTR, type PdfSurface } from "@/lib/annotations/pdfSurface";
import { markStyle, NoteGlyph, useDocumentAnnotations } from "./DocumentAnnotations";
import { useSessionStore } from "@/stores/session-store";
import type { FeedLocator } from "@/lib/reader/annotationFeed";
import type { Annotation } from "@/stores/library-store";
import { pdfView } from "@/lib/room/view";
import { useRoomView } from "@/lib/room/useRoomView";

const TOP_BAR_HEIGHT_PX = 60;
const RAIL_INSET_PX = 16;
const BOTTOM_BAR_HEIGHT_PX = 64;

/** The open document's id. EmbedPDF is multi-document and addresses
 * everything by id; each open gets a fresh one (DocumentManager generates it),
 * never a fixed one. The engine is shared by the tab and keeps documents by
 * id, and a viewer that unmounts closes its document asynchronously, so with
 * a fixed id a late close from the previous viewer (or React's dev double
 * mount) closed the next viewer's document: pages laid out and counted, but
 * every render failed, leaving them blank until a reload. */
const DocumentIdContext = createContext("");

const VIEWPORT_GAP_PX = 12;
const PAGE_GAP_PX = 16;

/** Zoom bounds, relative to the page's own size (1 = 100%). Wider than the old
 * 50–200% because tiling makes deep zoom cheap: only the visible part of a page
 * is ever rendered at full resolution, however far in the reader goes. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

/** The zoom that "fits the screen": the page's width, never enlarged past 100%.
 * On a phone that's a page exactly as wide as the screen (the old viewer rendered
 * it at its full 612px and let it overflow); on a desktop it's the page at its
 * real size. */
const FIT_ZOOM = ZoomMode.Automatic;

/** How each page is painted: a low-resolution image of the whole page, instantly
 * available as the page scrolls in, under full-resolution tiles covering only the
 * part of it on screen. Rendering whole pages at screen resolution is what broke
 * the old viewer on phones — at a 3x pixel ratio one page is ~17MB of bitmap, and
 * two dozen of them blew straight through iOS Safari's canvas memory limit, after
 * which pages came up blank. Tiles keep full-resolution memory at roughly one
 * screenful however many pages are loaded and however far the reader zooms. */
const BASE_LAYER_SCALE = 0.5;

/** `overscroll-behavior: contain` so reaching either end of the document doesn't
 * chain into scrolling (or pull-to-refresh on) the page behind the reader.
 * Horizontal centring is EmbedPDF's own (the zoom wrapper sets its margin). */
const viewportStyle = { position: "relative", background: "var(--reader-bg)", overscrollBehavior: "contain" } as const;

/** Honours a reader's reduced-motion setting for every page jump. */
function jumpBehavior() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "instant"
    : "smooth";
}

/**
 * PDF body renderer — see document-readers-spec.md § 1/§ 3. Whole-document
 * only: page navigation is the only "structure" here, no TOC. The document comes
 * straight from `sourceUrl` (a public Storage URL), downloaded by
 * PdfDocumentLoader — no server round trip beyond the material row already
 * loaded by `loadReaderMaterial`.
 *
 * Rendered by EmbedPDF on PDFium (Chrome's own PDF engine, compiled to
 * WebAssembly and run in a worker) rather than pdf.js. Pages arrive as images
 * rather than live canvases, so there is no canvas memory to exhaust, and PDFium
 * never falls back to the device's installed fonts, so a document looks the same
 * on every phone. See lib/pdf/pdfiumEngine.ts for the engine's lifecycle.
 *
 * Standalone (app/read, app/reader) and overlay (app/@modal/(.)read, via
 * DocumentOverlayShell) mount this the same way Reader/ReaderModal already
 * split: `onClose` present picks the close-X, absent picks the back-arrow —
 * same convention as ReaderHeader.
 *
 * One continuous vertical scroll of pages, reported as a page number: progress,
 * resume and the end panel all work in pages.
 *
 * Reading progress is tracked at page granularity (the `page` locator kind).
 * Zoom and intra-page scroll are deliberately not part of the position: a page
 * is what this viewer can restore exactly.
 */
export type PdfDocumentViewProps = {
  materialId: string;
  title: string;
  sourceUrl: string;
  /** `?page=` — a resume link's own target (see lib/reader/locator.ts's
   * buildResumeHref), which takes precedence over this device's saved
   * position. */
  urlLocator?: Locator;
  onClose?: () => void;
};

export default function PdfDocumentView({
  materialId,
  title,
  urlLocator,
  onClose,
  download,
  generation,
  onRetry,
}: PdfDocumentViewProps & {
  /** The document's bytes, fetched by PdfDocumentLoader so the download starts
   * before this module's own code has arrived. */
  download: PdfDownload;
  /** Bumped on every Retry — see PdfDocumentLoader. */
  generation: number;
  onRetry: () => void;
}) {
  const theme = useReaderStore((s) => s.theme);
  // These preferences skip automatic persist hydration so the server and the
  // client's first paint agree (see reader-store) — this viewer is a route of
  // its own, so it has to pull them in itself, the way Reader.tsx does.
  useEffect(() => {
    useReaderStore.persist.rehydrate();
  }, []);

  const { engine, error: engineError, discard: discardEngine } = usePdfEngine(generation);
  const { buffer, error: fetchError, progress } = download;

  // Retry refetches the document and, if the engine was what failed, starts a
  // fresh one rather than handing back the same failure.
  const retry = useCallback(
    (engineFailed: boolean) => {
      if (engineFailed) discardEngine();
      onRetry();
    },
    [discardEngine, onRetry]
  );

  let body: ReactNode;
  if (fetchError) {
    const isNotPdf = fetchError instanceof PdfFetchError && fetchError.kind === "not-pdf";
    body = (
      <PdfOpenError
        message={fetchError.message}
        onRetry={isNotPdf ? undefined : () => retry(false)}
        cause={fetchError}
      />
    );
  } else if (engineError) {
    body = (
      <PdfOpenError
        message="The PDF viewer couldn't start. Check your connection and try again."
        onRetry={() => retry(true)}
        cause={engineError}
      />
    );
  } else if (engine && buffer) {
    body = (
      <PdfReader
        // A new engine or new bytes is a new reader: EmbedPDF's plugins are bound
        // to both for their whole lifetime.
        key={generation}
        engine={engine}
        buffer={buffer}
        materialId={materialId}
        title={title}
        urlLocator={urlLocator}
        onRetry={retry}
      />
    );
  } else {
    // Once the bytes are in, what's left (the engine finishing its start-up,
    // PDFium opening the file) is short and unmeasurable, so no caption.
    body = <Loader confined label={!buffer && progress ? `Downloading · ${formatDownloadProgress(progress)}` : undefined} />;
  }

  return (
    <div
      data-reader-theme={theme}
      className="w-full h-dvh box-border overflow-hidden relative font-sans"
      style={{ background: "var(--reader-bg)" }}
    >
      <ReaderHeader materialId={materialId} topBarHeightPx={TOP_BAR_HEIGHT_PX} railInsetPx={RAIL_INSET_PX} onClose={onClose} title={title} />
      <div className="absolute inset-x-0 bottom-0" style={{ top: TOP_BAR_HEIGHT_PX }}>
        {body}
      </div>
    </div>
  );
}

/**
 * The viewer proper, once the engine and the document's bytes are both in hand.
 * Owns the EmbedPDF plugin registry, which is built once per mount: the plugins
 * are bound to one engine and one document for their whole lifetime.
 */
function PdfReader({
  engine,
  buffer,
  materialId,
  title,
  urlLocator,
  onRetry,
}: {
  engine: PdfEngine;
  buffer: ArrayBuffer;
  materialId: string;
  title: string;
  urlLocator?: Locator;
  onRetry: (engineFailed: boolean) => void;
}) {
  const plugins = useMemo(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, {
        maxDocuments: 1,
        initialDocuments: [{ buffer, name: title }],
      }),
      createPluginRegistration(ViewportPluginPackage, { viewportGap: VIEWPORT_GAP_PX }),
      createPluginRegistration(ScrollPluginPackage, { defaultPageGap: PAGE_GAP_PX, defaultBufferSize: 2 }),
      // Annotations and form fields drawn into the page image, as they appear in
      // any other PDF viewer — without these, a document's existing highlights,
      // stamps and filled-in fields would simply be missing.
      createPluginRegistration(RenderPluginPackage, { withAnnotations: true, withForms: true }),
      createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 2.5, extraRings: 0 }),
      createPluginRegistration(ZoomPluginPackage, {
        defaultZoomLevel: FIT_ZOOM,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
      }),
      // No interaction-manager / pan / selection plugins: text selection is the
      // shared engine's (lib/annotations), identical on every format, and with
      // none of EmbedPDF's pointer layers claiming touches, a drag on a phone is
      // simply a native scroll.
    ],
    [buffer, title]
  );

  return (
    <EmbedPDF engine={engine} plugins={plugins}>
      {({ pluginsReady, activeDocument: doc }) => {
        if (!pluginsReady || !doc || doc.status === "loading") return <Loader confined />;
        if (doc.status === "error") {
          const code = doc.errorCode;
          if (code === PdfErrorCode.Password) {
            return <PdfOpenError message="This PDF is password-protected, so it can't be opened here." />;
          }
          const engineFailed = code === PdfErrorCode.Initialization;
          return (
            <PdfOpenError
              message={
                engineFailed
                  ? "The PDF viewer couldn't start. Check your connection and try again."
                  : "This PDF couldn't be opened. The file may be damaged."
              }
              onRetry={() => onRetry(engineFailed)}
              cause={{ code, error: doc.error, details: doc.errorDetails }}
            />
          );
        }
        if (!doc.document?.pageCount) {
          return <PdfOpenError message="This PDF has no pages to show." />;
        }
        return (
          <DocumentIdContext.Provider value={doc.id}>
            <PdfReaderBody
              materialId={materialId}
              title={title}
              urlLocator={urlLocator}
              engine={engine}
              document={doc.document}
            />
          </DocumentIdContext.Provider>
        );
      }}
    </EmbedPDF>
  );
}

/** One page: the low-resolution base image, the full-resolution tiles over the
 * visible part of it, and the reader's highlights on top.
 *
 * `select-none no-callout`: a page is images, not text, as far as the browser
 * can tell, so iOS's own long-press selection grabbed the whole page as one
 * block (and offered to save the image). Text selection is the shared engine's
 * (lib/annotations), which draws its own. */
function renderPdfPage({ pageIndex }: PageLayout) {
  return <PdfPage pageIndex={pageIndex} />;
}

function PdfPage({ pageIndex }: { pageIndex: number }) {
  const documentId = useContext(DocumentIdContext);
  return (
    <div {...{ [PDF_PAGE_ATTR]: pageIndex }} className="relative h-full w-full bg-white shadow-sm select-none no-callout">
      <RenderLayer documentId={documentId} pageIndex={pageIndex} scale={BASE_LAYER_SCALE} className="pointer-events-none block" />
      <TilingLayer documentId={documentId} pageIndex={pageIndex} className="pointer-events-none" />
      <PdfHighlightLayer pageIndex={pageIndex} />
    </div>
  );
}

/** What each page's highlight layer reads — provided once by PdfReaderBody, so
 * the page renderer itself can stay a plain function the Scroller calls. */
type PdfAnnotationsContextValue = {
  surface: PdfSurface;
  document: PdfDocumentObject;
  getForPassage: (block: string) => Annotation[];
  onMarkClick: (block: string, annotationId: string) => void;
  readerId: string | null;
  /** Bumped as page geometry loads, so layers waiting on it re-render. */
  version: number;
};
const PdfAnnotationsContext = createContext<PdfAnnotationsContextValue | null>(null);

/**
 * A page's highlights and noted passages, drawn from PDFium's glyph geometry as
 * percentages of the page — so they sit exactly on the text at any zoom with no
 * re-measuring. Same rules as the EPUB reader's inline marks (PassageContent):
 * the reader's own highlight or own note washes the text; someone else's
 * public note shows only the note glyph; a pending selection (the notes panel
 * open on a new thread) shows the wash but isn't clickable.
 */
function PdfHighlightLayer({ pageIndex }: { pageIndex: number }) {
  const ctx = useContext(PdfAnnotationsContext);
  const data = ctx?.surface.page(pageIndex);
  if (!ctx || !data) return null;
  const block = pdfBlockId(pageIndex);
  const { width, height } = ctx.document.pages[pageIndex].size;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div className="absolute inset-0">
      {ctx.getForPassage(block).map((a) => {
        const range = a.ranges.find((r) => r.passageId === block);
        if (!range) return null;
        const rects = pdfRangeRects(data, range.start, range.end);
        if (!rects.length) return null;
        const { wash, clickable, noteCount } = markStyle(a, ctx.readerId);
        const isTail = a.ranges[a.ranges.length - 1].passageId === block;
        const last = rects[rects.length - 1];
        return (
          <div key={a.id}>
            {rects.map((r, i) => (
              <div
                key={i}
                data-annotation-id={a.id}
                onClick={clickable ? () => ctx.onMarkClick(block, a.id) : undefined}
                className={`absolute rounded-[2px] ${clickable ? "cursor-pointer" : "pointer-events-none"}`}
                style={{
                  left: pct(r.x, width),
                  top: pct(r.y, height),
                  width: pct(r.w, width),
                  height: pct(r.h, height),
                  background: wash ? "var(--reader-highlight)" : undefined,
                  mixBlendMode: "multiply",
                }}
              />
            ))}
            {/* Pages are always white paper, so the glyph keeps a fixed grey
                rather than the theme's muted text colour. */}
            {isTail && noteCount > 0 && (
              <NoteGlyph
                count={noteCount}
                onClick={() => ctx.onMarkClick(block, a.id)}
                style={{ left: pct(last.x + last.w, width), top: pct(last.y, height), marginLeft: 3, color: "#6b6b6b" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Hands the Viewport's scrolling element up to the reader — the Viewport keeps
 * its own ref and doesn't forward one, but exposes it to its children. */
function ViewportElementReporter({ onElement }: { onElement: (el: HTMLDivElement | null) => void }) {
  const ref = useViewportElement();
  useEffect(() => {
    onElement(ref?.current ?? null);
    return () => onElement(null);
  }, [ref, onElement]);
  return null;
}

function PdfReaderBody({
  materialId,
  title,
  urlLocator,
  engine,
  document,
}: {
  materialId: string;
  title: string;
  urlLocator?: Locator;
  engine: PdfEngine;
  document: PdfDocumentObject;
}) {
  const readerId = useSessionStore((s) => s.readerId);
  const documentId = useContext(DocumentIdContext);

  const { provides: scroll, state: scrollState } = useScroll(documentId);
  const { provides: scrollCapability } = useScrollCapability();
  const { provides: zoom, state: zoomState } = useZoom(documentId);

  const numPages = scrollState.totalPages;
  // Scrolled past the last page into the end panel, the scroll plugin sees no
  // page on screen and falls back to reporting page 1 — which would both show
  // "1 / 141" there and save page 1 as where the reader stopped. The reader has
  // seen the whole document at that point, so it's the last page.
  const [pastLastPage, setPastLastPage] = useState(false);
  useEffect(() => {
    if (!scroll) return;
    return scroll.onScroll((metrics) => setPastLastPage(metrics.visiblePages.length === 0 && metrics.scrollOffset.y > 0));
  }, [scroll]);
  const pageNumber = pastLastPage && numPages > 0 ? numPages : Math.max(1, scrollState.currentPage);

  // The Viewport's scrolling element, for the keyboard hook; state rather than a
  // ref because that hook binds to it in an effect.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  // Pages have been laid out and can be scrolled to. The event replays to late
  // subscribers, so it can't be missed by subscribing after the Scroller mounts.
  const [layoutReady, setLayoutReady] = useState(false);
  useEffect(() => {
    if (!scrollCapability) return;
    return scrollCapability.onLayoutReady((event) => {
      if (event.documentId === documentId) setLayoutReady(true);
    });
  }, [scrollCapability, documentId]);

  const scrollToPage = useCallback(
    (page: number, behavior: "instant" | "smooth") => {
      if (!scroll) return;
      scroll.scrollToPage({ pageNumber: Math.min(Math.max(1, page), numPages || 1), behavior });
    },
    [scroll, numPages]
  );

  const goToPage = useCallback((page: number) => scrollToPage(page, jumpBehavior()), [scrollToPage]);

  // The page number is the tracked signal reported by the
  // scroll plugin as the reader moves. Still the debounced `commit` rather than
  // an immediate write: scrolling quickly through a run of pages should record
  // where the reader stopped, not every page they passed. `commit` stays closed
  // until resume has landed (see useDocumentProgress), which is what stops the
  // initial page-1 report from overwriting the saved page.
  const { commit, getPositionNow, resumeApplied } = useDocumentProgress({
    materialId,
    kind: "page",
    urlLocator,
    scale: numPages > 0 ? { kind: "page", pageCount: numPages } : undefined,
    contentReady: layoutReady && numPages > 0,
    // Clamped (in scrollToPage): a saved page can outlive the document it
    // pointed into — a re-uploaded, shorter PDF.
    apply: useCallback((locator: { page: number }) => scrollToPage(locator.page, "instant"), [scrollToPage]),
    read: useCallback(() => ({ kind: "page" as const, page: pageNumber }), [pageNumber]),
  });
  useEffect(() => {
    if (layoutReady) commit({ kind: "page", page: pageNumber });
  }, [pageNumber, layoutReady, commit]);

  useDocumentKeyboard({ scrollElement: scrollEl });

  const zoomLevel = zoomState.currentZoomLevel;

  // The PDF as a selection surface: PDFium's text and glyph geometry, loaded
  // for each page as it comes into view.
  const surface = useMemo(
    () => (scrollEl ? createPdfSurface(scrollEl, engine, document) : null),
    [scrollEl, engine, document]
  );
  const [geometryVersion, setGeometryVersion] = useState(0);
  useEffect(() => surface?.onPageLoad(() => setGeometryVersion((n) => n + 1)), [surface]);
  useEffect(() => {
    if (!scroll || !surface) return;
    // Replays the current metrics on subscribe, so the first screenful loads too.
    return scroll.onScroll((metrics) => metrics.renderedPageIndexes.forEach((i) => surface.ensurePage(i)));
  }, [scroll, surface]);

  const getPassageText = useCallback(
    (block: string) => surface?.page(pdfPageIndexOf(block))?.text ?? "",
    [surface]
  );
  // The notes feed files each highlight under its page.
  const locate = useCallback<FeedLocator>((block) => {
    const index = pdfPageIndexOf(block);
    return index < 0 ? null : { sectionId: block, label: `Page ${index + 1}`, order: index };
  }, []);
  const jumpToBlock = useCallback((block: string) => goToPage(pdfPageIndexOf(block) + 1), [goToPage]);

  // Highlights and notes: the same selection engine, menu, notes panel and
  // feed as every other reader — only the surface, and drawing the marks on
  // each page (PdfHighlightLayer), are the PDF's own.
  const { annotations, onMarkClick, chrome } = useDocumentAnnotations({
    materialId,
    surface,
    scrollEl,
    layoutKey: `${zoomLevel}|${geometryVersion}`,
    getPassageText,
    locate,
    jumpToBlock,
    activeBlock: pdfBlockId(pageNumber - 1),
  });
  const { getForPassage } = annotations;

  // This reader as a live room sees it (lib/room/view.ts), once it has landed.
  const roomView = useMemo(
    () =>
      resumeApplied && scrollEl && scroll && numPages > 0
        ? pdfView({
            materialId,
            root: scrollEl,
            pageCount: numPages,
            pageSize: (pageIndex) => document.pages[pageIndex]?.size,
            scrollToPage: (options) => scroll.scrollToPage(options),
            surface: () => surface,
          })
        : null,
    [resumeApplied, scrollEl, scroll, numPages, materialId, document, surface]
  );
  useRoomView(roomView, annotations.selection?.ranges ?? null);

  const annotationsContext = useMemo<PdfAnnotationsContextValue | null>(
    () =>
      surface && {
        surface,
        document,
        getForPassage,
        onMarkClick,
        readerId,
        version: geometryVersion,
      },
    [surface, document, getForPassage, onMarkClick, readerId, geometryVersion]
  );

  const zoomInfo = {
    percent: Math.round(zoomLevel * 100),
    isCustom: typeof zoomState.zoomLevel === "number",
    canZoomIn: zoomLevel < MAX_ZOOM - 0.001,
    canZoomOut: zoomLevel > MIN_ZOOM + 0.001,
  };
  return (
    <PdfAnnotationsContext.Provider value={annotationsContext}>
      <div className="absolute inset-x-0 top-0" style={{ bottom: `calc(${BOTTOM_BAR_HEIGHT_PX}px + env(safe-area-inset-bottom))` }}>
        <Viewport documentId={documentId} style={viewportStyle}>
            <ViewportElementReporter onElement={setScrollEl} />
            {/* Pinch and ⌘/Ctrl-scroll zoom are the viewer's own: it re-renders sharp
                at the new zoom, instead of the browser magnifying a bitmap — the
                "blurry text" half of the old viewer's problem. */}
            <ZoomGestureWrapper documentId={documentId} style={{ position: "relative" }}>
              <Scroller documentId={documentId} renderPage={renderPdfPage} />
            </ZoomGestureWrapper>
            {/* The end screen simply sits after the last page. Sticky to the left
                edge so it stays in view when a zoomed-in document is scrolled
                sideways. */}
            <div className="sticky left-0 w-full text-left">
              <div className="mx-auto max-w-[640px] px-6">
                <DocumentEndPanel materialId={materialId} title={title} getCurrentPosition={getPositionNow} />
              </div>
            </div>
          </Viewport>
      </div>
      {/* A page number stands in for a section title, since pages are the only
          "structure" a PDF has (see document-readers-spec.md § 3) — and, unlike
          EPUB's ChapterNavFooter, this is always visible rather than
          scroll-revealed: it carries the page input, which has to be reachable
          at any moment, not just at a section boundary. */}
      {numPages > 0 && (
        <PdfPagerFooter
          pageNumber={pageNumber}
          numPages={numPages}
          zoom={zoomInfo}
          onGoToPage={goToPage}
          onZoomIn={() => zoom?.zoomIn()}
          onZoomOut={() => zoom?.zoomOut()}
          onZoomReset={() => zoom?.requestZoom(FIT_ZOOM)}
        />
      )}

      {chrome}
    </PdfAnnotationsContext.Provider>
  );
}

function PdfOpenError({ message, onRetry, cause }: { message: string; onRetry?: () => void; cause?: unknown }) {
  // The reader sees a plain sentence; the console gets what actually went wrong.
  useEffect(() => {
    if (cause !== undefined) console.error("[pdf reader]", message, cause);
  }, [message, cause]);
  return (
    <div className="flex h-full items-center justify-center p-6" role="alert">
      <div className="max-w-sm text-center">
        <p className="text-[15px] font-semibold text-[var(--reader-text)]">Couldn&apos;t open this PDF</p>
        <p className="mt-2 text-[13px] text-[var(--reader-text-muted)]">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 cursor-pointer rounded-md border border-[var(--reader-border)] bg-transparent px-4 py-2 text-[13px] font-semibold text-[var(--reader-text)] transition-colors hover:bg-[var(--reader-surface-hover)]"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
