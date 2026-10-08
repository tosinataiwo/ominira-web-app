"use client";

import { useCallback, useMemo, useState } from "react";
import { useReaderStore, useTypographyStyle } from "@/stores/reader-store";
import type { Locator } from "@/lib/reader/locator";
import { useArticleProgress } from "@/lib/reader/useArticleProgress";
import { useDocumentKeyboard } from "@/lib/reader/useDocumentKeyboard";
import DocumentEndPanel from "./DocumentEndPanel";
import ReaderHeader from "./ReaderHeader";
import { ARTICLE_SCROLL_CLASS, useArticleAnnotations } from "./useArticleAnnotations";
import { ArticleNarrationFollower, useArticleNarration } from "./useArticleNarration";
import { useDockedHeight } from "@/app/components/useBottomDock";

const TOP_BAR_HEIGHT_PX = 60;
const RAIL_INSET_PX = 16;

/**
 * Web-page body renderer — see document-readers-spec.md § 1/§ 3. Renders
 * the *already* Readability-extracted HTML (never re-fetches or re-extracts
 * the live page at read time — that happened once, server-side, at
 * ingestion), fetched server-side by loadReaderMaterial alongside the rest
 * of the material row, so it arrives as a prop exactly like EPUB's
 * BookDocument — no client-side loading gate before the article can render.
 * Renders it the same reflowing-article way as DocxDocumentView, via the
 * shared `.reader-article` typography (globals.css). The "View original"
 * link (Brave-Speedreader-style) lives in ReaderHeader itself via its
 * `sourceUrl` prop, since the extracted
 * copy is deliberately a stripped derivative, not a replacement for the
 * source.
 *
 * Reading progress is tracked by block index, the same way DocxDocumentView
 * does it (see useArticleProgress) — the two render identically, so they share
 * one implementation rather than each approximating it.
 */
export default function ArticleDocumentView({
  materialId,
  title,
  sourceUrl,
  articleHtml,
  urlLocator,
  onClose,
}: {
  materialId: string;
  title: string;
  sourceUrl: string;
  articleHtml: string;
  /** `?block=` — a resume link's own target, which takes precedence over this
   * device's saved position (see buildResumeHref). */
  urlLocator?: Locator;
  onClose?: () => void;
}) {
  const theme = useReaderStore((s) => s.theme);
  const typographyStyle = useTypographyStyle();
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
  // One markup object per article: React re-sets innerHTML whenever it gets a
  // new `{ __html }` object, which would replace the article (and the
  // paragraph under a reader's finger) on every render.
  const markup = useMemo(() => ({ __html: articleHtml }), [articleHtml]);

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
        sourceUrl={sourceUrl}
        {...listen}
      />
      <div ref={scrollRef} className={ARTICLE_SCROLL_CLASS} style={{ paddingTop: TOP_BAR_HEIGHT_PX, paddingBottom: dockedHeight }}>
        <div className="mx-auto px-6 py-10" style={{ maxWidth: "var(--reader-max-width)" }}>
          <div
            ref={attachContent}
            className="reader-article"
            dangerouslySetInnerHTML={markup}
          />
          {/* The bottom of the scroll *is* the end of the document here — no
              "have they reached it" test needed, unlike a paginated viewer. */}
          <DocumentEndPanel materialId={materialId} title={title} getCurrentPosition={getPositionNow} />
        </div>
      </div>
      {highlights}
      {chrome}
      <ArticleNarrationFollower materialId={materialId} contentEl={contentEl} scrollEl={scrollElement} />
    </div>
  );
}
