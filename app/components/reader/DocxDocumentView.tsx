"use client";

import { useCallback, useEffect, useState } from "react";
import { useReaderStore, useTypographyStyle } from "@/stores/reader-store";
import type { Locator } from "@/lib/reader/locator";
import { useArticleProgress } from "@/lib/reader/useArticleProgress";
import { useDocumentKeyboard } from "@/lib/reader/useDocumentKeyboard";
import DocumentEndPanel from "./DocumentEndPanel";
import ReaderHeader from "./ReaderHeader";
import { ARTICLE_SCROLL_CLASS, useArticleAnnotations } from "./useArticleAnnotations";
import { ArticleNarrationFollower, useArticleNarration } from "./useArticleNarration";
import { useDockedHeight } from "@/app/components/useBottomDock";
import { cacheDocument, readCachedDocument } from "@/lib/offline/documentCache";
import Loader from "../Loader";

/** The .docx bytes — the device's copy when this document was opened before
 * (lib/offline/documentCache.ts), otherwise downloaded once and kept. */
async function loadDocx(url: string): Promise<ArrayBuffer> {
  const cached = await readCachedDocument(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  cacheDocument(url, buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  return buffer;
}

const TOP_BAR_HEIGHT_PX = 60;
const RAIL_INSET_PX = 16;

/**
 * DOCX body renderer — see document-readers-spec.md § 1/§ 3. Whole-document
 * only, no highlighting, no TOC: fetches `sourceUrl` client-side, runs it
 * through `mammoth.convertToHtml` (→ semantic HTML: headings/lists/bold/
 * italic), and renders it as a reflowing article via the shared
 * `.reader-article` typography (globals.css — the same reading tokens
 * EPUB's BookContent uses). Converts on every open rather than caching
 * the HTML — revisit only if real-world files prove slow.
 *
 * Mounts the same dual way Reader/PdfDocumentView already do: standalone
 * (app/read, app/reader) vs. wrapped in DocumentOverlayShell for the
 * intercepted route — `onClose` present picks the close-X, absent the
 * back-arrow.
 *
 * Reading progress is tracked by block index (see useArticleProgress), which
 * only starts once the converted HTML is actually in the DOM — the refs below
 * are what tell it so.
 */
export default function DocxDocumentView({
  materialId,
  title,
  sourceUrl,
  urlLocator,
  onClose,
}: {
  materialId: string;
  title: string;
  sourceUrl: string;
  /** `?block=` — a resume link's own target, which takes precedence over this
   * device's saved position (see buildResumeHref). */
  urlLocator?: Locator;
  onClose?: () => void;
}) {
  const theme = useReaderStore((s) => s.theme);
  const typographyStyle = useTypographyStyle();
  // The markup object itself is state, not rebuilt per render: React re-sets
  // innerHTML whenever it gets a new `{ __html }` object, which would replace
  // the article (and the paragraph under a reader's finger) on every render.
  const [markup, setMarkup] = useState<{ __html: string } | null>(null);
  const [error, setError] = useState(false);
  const { scrollRef, contentRef, scrollElement, getPositionNow, resumeApplied } = useArticleProgress({
    materialId,
    urlLocator,
  });
  // Arrows/PageUp/PageDown/Space/Home/End scroll the document on desktop — see
  // the hook; with no pages to turn, ←/→ move by a screenful.
  useDocumentKeyboard({ scrollElement });
  // The article element, for narration, alongside useArticleProgress's own.
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const attachArticle = useCallback(
    (el: HTMLDivElement | null) => {
      contentRef(el);
      setContentEl(el);
    },
    [contentRef]
  );
  const { listen, listenFrom } = useArticleNarration({ materialId, title, contentEl });
  const { attachContent, chrome, highlights } = useArticleAnnotations({
    materialId,
    title,
    contentRef: attachArticle,
    scrollElement,
    ready: resumeApplied,
    onListenFrom: listen.canListen ? listenFrom : undefined,
  });
  // Keeps the end of the article clear of the narration bar / room player.
  const dockedHeight = useDockedHeight();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ default: mammoth }, arrayBuffer] = await Promise.all([import("mammoth"), loadDocx(sourceUrl)]);
        const { value } = await mammoth.convertToHtml({ arrayBuffer });
        if (!cancelled) setMarkup({ __html: value });
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // sourceUrl never changes for a mounted viewer (a new material is a new
    // route, so a new component instance) — this effect is deliberately
    // run-once, not a resync-on-prop-change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      data-reader-theme={theme}
      className="reader-typography w-full h-dvh box-border flex flex-col overflow-hidden relative font-sans"
      style={{ ...typographyStyle, background: "var(--reader-bg)" }}
    >
      <ReaderHeader
        topBarHeightPx={TOP_BAR_HEIGHT_PX}
        railInsetPx={RAIL_INSET_PX}
        onClose={onClose}
        title={title}
        {...listen}
      />
      <div ref={scrollRef} className={ARTICLE_SCROLL_CLASS} style={{ paddingTop: TOP_BAR_HEIGHT_PX, paddingBottom: dockedHeight }}>
        <div className="mx-auto px-6 py-10" style={{ maxWidth: "var(--reader-max-width)" }}>
          {error ? (
            <p className="text-sm text-[var(--reader-text-muted)]">This document couldn&apos;t be opened.</p>
          ) : markup === null ? (
            <Loader confined />
          ) : (
            <div
              ref={attachContent}
              className="reader-article"
              dangerouslySetInnerHTML={markup}
            />
          )}
          {/* Only once the conversion has actually produced something to reach
              the end *of* — the bottom of the scroll is the end of the
              document here, same as ArticleDocumentView. */}
          {markup !== null && !error && (
            <DocumentEndPanel materialId={materialId} title={title} getCurrentPosition={getPositionNow} />
          )}
        </div>
      </div>
      {highlights}
      {chrome}
      <ArticleNarrationFollower materialId={materialId} contentEl={contentEl} scrollEl={scrollElement} />
    </div>
  );
}
