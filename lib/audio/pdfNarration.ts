import type { Section } from "@/lib/book/schema";
import { pdfBlockId, pdfRangeRects, type PdfPageText } from "@/lib/annotations/pdfSurface";
import type { NarrationDocument } from "@/lib/audio/narrationDocument";

// Narration for PDFs: one section per page (so section i is page i + 1, the
// `page` locator), each holding the page's PDFium text as one passage, split
// into TTS chunks by the shared narrationText. Using the surface's own text,
// offsets unchanged, is what lets word N be drawn from its glyph boxes.

/** Below this, a page's "text" is a page number or a stamp — not worth reading
 * aloud, and not evidence the PDF has a text layer. */
const MIN_PAGE_CHARS = 20;

export function pdfPageHasText(page: PdfPageText | undefined): boolean {
  return (page?.text.replace(/\s+/g, "").length ?? 0) >= MIN_PAGE_CHARS;
}

/** A page's text as it's spoken: line breaks and tabs (some PDFs space every
 * word with one) become spaces, one for one, so every offset (and every \S+
 * word) still matches the page's own text — and Edge TTS doesn't pause at
 * them as if a sentence had ended. */
const spoken = (text: string) => text.replace(/[\r\n\t]/g, " ");

/** The PDF as narration sees it. Pages whose text hasn't loaded yet are empty
 * sections, skipped like any section with nothing to read; the viewer rebuilds
 * this (updateBookContent) as pages load. Section ids are `page-<index>`; a
 * page's one passage is its pdfBlockId. */
export function pdfNarrationDocument(opts: {
  materialId: string;
  title: string;
  pageCount: number;
  page: (pageIndex: number) => PdfPageText | undefined;
}): NarrationDocument {
  const sections: Section[] = Array.from({ length: opts.pageCount }, (_, i) => {
    const data = opts.page(i);
    return {
      id: `page-${i}`,
      title: `Page ${i + 1}`,
      kind: "body",
      passages: pdfPageHasText(data) ? [{ id: pdfBlockId(i), index: 0, type: "paragraph", text: spoken(data!.text) }] : [],
      children: [],
    };
  });
  return {
    id: opts.materialId,
    slug: opts.materialId,
    metadata: { title: opts.title },
    spine: sections.map((s) => s.id),
    sections,
    scale: { kind: "page", pageCount: opts.pageCount },
  };
}

/** Rects (page points) of a page's word `wordIndex`, counted as \S+ runs —
 * the same count KaraokeWord.index uses. */
export function pdfWordRects(data: PdfPageText, wordIndex: number) {
  const re = /\S+/g;
  let match: RegExpExecArray | null = null;
  for (let i = 0; i <= wordIndex; i++) {
    match = re.exec(data.text);
    if (!match) return [];
  }
  return pdfRangeRects(data, match!.index, match!.index + match![0].length);
}
