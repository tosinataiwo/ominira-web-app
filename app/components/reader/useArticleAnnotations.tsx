"use client";

import { useCallback, useMemo, useState } from "react";
import { createDomSurface, indexedBlockId, indexOfBlockId } from "@/lib/annotations/surface";
import type { FeedLocation, FeedLocator } from "@/lib/reader/annotationFeed";
import { articleBlocks } from "@/lib/reader/useArticleProgress";
import type { useArticleTypographyStyle } from "@/lib/reader/useArticleTypographyStyle";
import { articleView } from "@/lib/room/view";
import { useRoomView } from "@/lib/room/useRoomView";
import { DomHighlights, useDocumentAnnotations } from "./DocumentAnnotations";

/** The article's scroll container: positioned and its own stacking context
 * (highlights are drawn inside it, behind the text — see DomHighlights), and
 * with native selection off (the shared engine selects; on iOS that's the only
 * way to keep the system's own Copy/Look Up menu away). */
export const ARTICLE_SCROLL_CLASS = "flex-1 min-h-0 overflow-auto relative isolate select-none no-callout";

/**
 * Highlights and notes for a reflowing HTML document — a web article or a
 * converted DOCX. Returns a ref to put on the article's content element (in
 * place of useArticleProgress's own, which it forwards to), the highlight
 * layer, and the selection/notes chrome.
 *
 * Blocks are the same ones useArticleProgress tracks reading position by
 * (articleBlocks), named by index — `b17` — and found afresh from the DOM on
 * every lookup rather than tagged onto it: the HTML is React's
 * (dangerouslySetInnerHTML), which can replace it wholesale at any time.
 */
export function useArticleAnnotations({
  materialId,
  title,
  contentRef,
  scrollElement,
  typography,
  ready,
}: {
  materialId: string;
  /** Labels the notes feed's run for text before the first heading. */
  title: string;
  /** useArticleProgress's content ref, called through. */
  contentRef: (el: HTMLDivElement | null) => void;
  scrollElement: HTMLDivElement | null;
  typography: ReturnType<typeof useArticleTypographyStyle>;
  /** The reader has landed (useArticleProgress's resumeApplied). */
  ready: boolean;
}) {
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const attachContent = useCallback(
    (el: HTMLDivElement | null) => {
      contentRef(el);
      setContentEl(el);
    },
    [contentRef]
  );

  const surface = useMemo(
    () => (contentEl ? createDomSurface(contentEl, { listBlocks: () => articleBlocks(contentEl) }) : null),
    [contentEl]
  );
  const getPassageText = useCallback(
    (block: string) => {
      if (!contentEl) return "";
      return articleBlocks(contentEl)[indexOfBlockId(block)]?.textContent ?? "";
    },
    [contentEl]
  );
  // The notes feed files each block under the heading it follows — the
  // article's nearest thing to a chapter.
  const locate = useMemo<FeedLocator>(() => {
    const at = new Map<string, FeedLocation>();
    const blocks = contentEl ? articleBlocks(contentEl) : [];
    let run = { sectionId: "start", label: title };
    for (let i = 0; i < blocks.length; i++) {
      const heading = /^H[1-6]$/.test(blocks[i].tagName) && blocks[i].textContent?.trim();
      if (heading) run = { sectionId: indexedBlockId(i), label: heading };
      at.set(indexedBlockId(i), { ...run, order: i });
    }
    return (block) => at.get(block) ?? null;
  }, [contentEl, title]);
  const jumpToBlock = useCallback(
    (block: string) => {
      if (!contentEl) return;
      articleBlocks(contentEl)[indexOfBlockId(block)]?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [contentEl]
  );
  // Typography changes reflow the text under the highlights and selection.
  const layoutKey = `${typography.fontFamily}|${typography.fontSize}|${typography.lineHeight}|${typography.maxWidth}`;

  const { annotations, onMarkClick, chrome } = useDocumentAnnotations({
    materialId,
    surface,
    scrollEl: scrollElement,
    layoutKey,
    getPassageText,
    locate,
    jumpToBlock,
  });

  // The article as a live room sees it (lib/room/view.ts).
  const roomView = useMemo(
    () =>
      ready && scrollElement && contentEl
        ? articleView({ materialId, root: scrollElement, blocks: () => articleBlocks(contentEl), surface: () => surface })
        : null,
    [ready, scrollElement, contentEl, materialId, surface]
  );
  useRoomView(roomView, annotations.selection?.ranges ?? null);

  const highlights = (
    <DomHighlights
      surface={surface}
      scrollEl={scrollElement}
      annotations={annotations.annotations}
      onMarkClick={onMarkClick}
      layoutKey={layoutKey}
    />
  );

  return { attachContent, chrome, highlights };
}
