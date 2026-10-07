import type { AnnotationRange } from "@/lib/api/types";
import { PDF_PAGE_ATTR } from "@/lib/annotations/pdfSurface";
import type { SelectionSurface } from "@/lib/annotations/surface";
import type { Section } from "@/lib/book/schema";
import type { Locator, LocatorScale, ReaderMode } from "@/lib/reader/locator";

// The open reader as the room sees it (spec §9): where its reading line is,
// how to bring a place there, where a place sits on screen, and how far
// through the book a place is. Each format builds one from its own blocks
// (an EPUB passage, a PDF page, an article block) and registers it with
// useRoomView; lib/room/follow.ts and the room's text layer use nothing else
// of the reader. Loaded with the readers, not the room, so it stays small.

/** A place in the text: a locator and a 0–1 offset within its block. */
export type ViewPlace = { locator: Locator; offset: number };

export type ReaderView = {
  materialId: string;
  mode: ReaderMode;
  /** The reading area. Scrolls (captured), wheel, touch and keys inside it
   * are the reader moving. */
  root: HTMLElement;
  /** The place on the reading line (the middle of the visible text). */
  read(): ViewPlace | undefined;
  /** Brings a place to the reading line. */
  show(place: ViewPlace): void;
  /** A place's viewport y, or null when its block isn't on this page
   * (another EPUB section, a PDF page not rendered). */
  lineOf(place: ViewPlace): number | null;
  /** 0–1 through the material, or null for a place this view can't address. */
  fraction(place: ViewPlace): number | null;
  placeAt(fraction: number): ViewPlace | undefined;
  /** "On p. 4": the section for EPUB, the page for PDF, a percentage otherwise. */
  label(place: ViewPlace): string;
  /** Where text shows: the scroller below the reader's header. */
  bounds(): DOMRect | null;
  /** The text column at the reading line, for the margin. */
  column(): DOMRect | null;
  /** Viewport rects of saved ranges on this page, for the speaker band. */
  rectsFor(ranges: readonly AnnotationRange[]): DOMRect[];
};

// ── Place maths (pure) ──────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Like locatorPercent, but 0–1, with the offset, and null (not 0) for a
 * place this scale can't address. */
export function placeFraction(scale: LocatorScale | undefined, { locator, offset }: ViewPlace): number | null {
  if (!scale || scale.kind !== locator.kind) return null;
  switch (locator.kind) {
    case "epub": {
      const { spine, sectionPassageCounts } = scale as Extract<LocatorScale, { kind: "epub" }>;
      const index = spine.indexOf(locator.sectionId);
      if (index < 0) return null;
      const count = sectionPassageCounts[locator.sectionId] ?? 0;
      const within = count > 0 ? clamp01((locator.passageIndex + offset) / count) : offset;
      return clamp01((index + within) / spine.length);
    }
    case "page": {
      const { pageCount } = scale as Extract<LocatorScale, { kind: "page" }>;
      return pageCount > 0 ? clamp01((locator.page - 1 + offset) / pageCount) : null;
    }
    case "block": {
      const { blockCount } = scale as Extract<LocatorScale, { kind: "block" }>;
      return blockCount > 0 ? clamp01((locator.blockIndex + offset) / blockCount) : null;
    }
  }
}

/** A run of `count` units at a 0–1 point: the unit, and how far into it. */
function unitAt(fraction: number, count: number) {
  const at = clamp01(fraction) * count;
  const index = Math.min(Math.floor(at), count - 1);
  return { index, offset: clamp01(at - index) };
}

/** The inverse of placeFraction. */
export function placeAtFraction(scale: LocatorScale, fraction: number): ViewPlace | undefined {
  switch (scale.kind) {
    case "epub": {
      if (!scale.spine.length) return undefined;
      const section = unitAt(fraction, scale.spine.length);
      const sectionId = scale.spine[section.index];
      const count = scale.sectionPassageCounts[sectionId] ?? 0;
      if (count === 0) return { locator: { kind: "epub", sectionId, passageIndex: 0 }, offset: 0 };
      const passage = unitAt(section.offset, count);
      return { locator: { kind: "epub", sectionId, passageIndex: passage.index }, offset: passage.offset };
    }
    case "page": {
      if (!scale.pageCount) return undefined;
      const page = unitAt(fraction, scale.pageCount);
      return { locator: { kind: "page", page: page.index + 1 }, offset: page.offset };
    }
    case "block": {
      if (!scale.blockCount) return undefined;
      const block = unitAt(fraction, scale.blockCount);
      return { locator: { kind: "block", blockIndex: block.index }, offset: block.offset };
    }
  }
}

// ── Views (DOM) ─────────────────────────────────────────────────────────────

type Block = { el: HTMLElement; locator: Locator };

type BlockViewOptions = {
  materialId: string;
  mode: ReaderMode;
  root: HTMLElement;
  scroller: () => HTMLElement | null | undefined;
  /** The header laid over the top of the scroller. */
  topInset: () => number;
  scale: () => LocatorScale | undefined;
  /** The blocks in the DOM now, in reading order. */
  blocks: () => Block[];
  /** A block's element, while it's in the DOM. */
  element: (locator: Locator) => HTMLElement | null;
  /** Brings a block that isn't in the DOM into it (another EPUB section). */
  reveal?: (locator: Locator) => void;
  /** Scrolls to a place its own way (PDF pages go through their plugin). */
  scrollTo?: (place: ViewPlace, behavior: ScrollBehavior) => void;
  label: (locator: Locator, fraction: number | null) => string;
  surface: () => SelectionSurface | null;
};

/** Frames to wait for a revealed block to mount before giving up. */
const REVEAL_FRAMES = 20;

/** Smooth for a short move, instant for a long one or with reduced motion. */
function motion(distance: number, height: number): ScrollBehavior {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return reduced || Math.abs(distance) > height * 2 ? "instant" : "smooth";
}

const percentLabel = (fraction: number | null) => `${Math.round((fraction ?? 0) * 100)}% through`;

/** A view over a reader made of blocks stacked in one scroller. */
function blockView(o: BlockViewOptions): ReaderView {
  const bounds = () => {
    const scroller = o.scroller();
    if (!scroller) return null;
    const r = scroller.getBoundingClientRect();
    const inset = o.topInset();
    return new DOMRect(r.left, r.top + inset, r.width, Math.max(0, r.height - inset));
  };
  const line = () => {
    const b = bounds();
    return b && b.top + b.height / 2;
  };
  /** The block on the reading line (or the first below it), and where in it. */
  const atLine = () => {
    const y = line();
    if (y === null) return undefined;
    const blocks = o.blocks();
    for (const block of blocks) {
      const r = block.el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > y) return { block, rect: r, offset: r.top >= y ? 0 : clamp01((y - r.top) / r.height) };
    }
    const last = blocks.at(-1);
    return last && { block: last, rect: last.el.getBoundingClientRect(), offset: 1 };
  };
  const fraction = (place: ViewPlace) => placeFraction(o.scale(), place);
  // A newer show() cancels a reveal still waiting on an older one.
  let showing = 0;

  return {
    materialId: o.materialId,
    mode: o.mode,
    root: o.root,
    bounds,
    read() {
      const hit = atLine();
      return hit && { locator: hit.block.locator, offset: hit.offset };
    },
    show(place) {
      const token = ++showing;
      const attempt = (frame: number) => {
        if (token !== showing) return;
        const r = o.element(place.locator)?.getBoundingClientRect();
        const y = line();
        const height = bounds()?.height ?? 0;
        const distance = r && y !== null ? r.top + place.offset * r.height - y : null;
        if (o.scrollTo) return o.scrollTo(place, distance === null ? "instant" : motion(distance, height));
        if (distance !== null) return void o.scroller()?.scrollBy({ top: distance, behavior: motion(distance, height) });
        if (frame === 0) o.reveal?.(place.locator);
        if (frame < REVEAL_FRAMES) requestAnimationFrame(() => attempt(frame + 1));
      };
      attempt(0);
    },
    lineOf(place) {
      const el = o.element(place.locator);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.height > 0 ? r.top + place.offset * r.height : null;
    },
    fraction,
    placeAt(f) {
      const scale = o.scale();
      return scale && placeAtFraction(scale, f);
    },
    label: (place) => o.label(place.locator, fraction(place)),
    column: () => atLine()?.rect ?? null,
    rectsFor(ranges) {
      const surface = o.surface();
      if (!surface) return [];
      return ranges.flatMap((r) =>
        surface.rectsFor({ block: r.passageId, offset: r.start }, { block: r.passageId, offset: r.end }),
      );
    },
  };
}

/** EPUB: the passages of the section on screen, found in the DOM (one
 * section slide is mounted at a time), so a place in another section can
 * turn to it and then be found there. */
export function epubView(o: {
  materialId: string;
  mode: ReaderMode;
  root: HTMLElement;
  topInset: () => number;
  scale: Extract<LocatorScale, { kind: "epub" }>;
  section: (sectionId: string) => Section | undefined;
  goToSection: (sectionId: string) => void;
  sectionLabel: (sectionId: string) => string | null;
  surface: () => SelectionSurface | null;
}): ReaderView {
  // Passage id → index, per section; sections are new objects as text loads.
  const indexes = new WeakMap<Section, Map<string, number>>();
  const indexOf = (section: Section) => {
    let index = indexes.get(section);
    if (!index) indexes.set(section, (index = new Map(section.passages.map((p, i) => [p.id, i]))));
    return index;
  };
  const slide = () => o.root.querySelector<HTMLElement>("[data-section-id]");

  return blockView({
    ...o,
    scroller: slide,
    scale: () => o.scale,
    blocks() {
      const el = slide();
      const sectionId = el?.dataset.sectionId;
      const section = sectionId ? o.section(sectionId) : undefined;
      if (!el || !sectionId || !section) return [];
      const index = indexOf(section);
      const blocks: Block[] = [];
      for (const passage of el.querySelectorAll<HTMLElement>("[data-passage-id]")) {
        const passageIndex = index.get(passage.dataset.passageId!);
        if (passageIndex !== undefined) blocks.push({ el: passage, locator: { kind: "epub", sectionId, passageIndex } });
      }
      return blocks;
    },
    element(locator) {
      const el = slide();
      if (locator.kind !== "epub" || el?.dataset.sectionId !== locator.sectionId) return null;
      const passage = o.section(locator.sectionId)?.passages[locator.passageIndex];
      return passage ? el.querySelector<HTMLElement>(`[data-passage-id="${CSS.escape(passage.id)}"]`) : null;
    },
    reveal: (locator) => locator.kind === "epub" && o.goToSection(locator.sectionId),
    label: (locator, fraction) =>
      locator.kind === "epub" ? `On ${o.sectionLabel(locator.sectionId) ?? "this chapter"}` : percentLabel(fraction),
  });
}

/** Web articles and DOCX: the article's top-level blocks (articleBlocks).
 * The scroller's top padding is what clears the header. */
export function articleView(o: {
  materialId: string;
  root: HTMLElement;
  blocks: () => HTMLElement[];
  surface: () => SelectionSurface | null;
}): ReaderView {
  return blockView({
    ...o,
    mode: "read",
    scroller: () => o.root,
    topInset: () => parseFloat(getComputedStyle(o.root).paddingTop) || 0,
    scale: () => {
      const blockCount = o.blocks().length;
      return blockCount > 0 ? { kind: "block", blockCount } : undefined;
    },
    blocks: () => o.blocks().map((el, blockIndex) => ({ el, locator: { kind: "block", blockIndex } })),
    element: (locator) => (locator.kind === "block" ? (o.blocks()[locator.blockIndex] ?? null) : null),
    label: (_, fraction) => percentLabel(fraction),
  });
}

/** PDF: the rendered pages. Pages come and go as the reader scrolls, so
 * showing a place goes through the scroll plugin, which reaches any page. */
export function pdfView(o: {
  materialId: string;
  root: HTMLElement;
  pageCount: number;
  /** A page's size in PDF points (0-based index). */
  pageSize: (pageIndex: number) => { width: number; height: number } | undefined;
  scrollToPage: (options: {
    pageNumber: number;
    pageCoordinates?: { x: number; y: number };
    alignX: number;
    alignY: number;
    behavior: ScrollBehavior;
  }) => void;
  surface: () => SelectionSurface | null;
}): ReaderView {
  const pageOf = (el: HTMLElement) => Number(el.getAttribute(PDF_PAGE_ATTR)) + 1;
  return blockView({
    ...o,
    mode: "read",
    topInset: () => 0,
    scroller: () => o.root,
    scale: () => ({ kind: "page", pageCount: o.pageCount }),
    blocks: () =>
      Array.from(o.root.querySelectorAll<HTMLElement>(`[${PDF_PAGE_ATTR}]`))
        .map((el) => ({ el, locator: { kind: "page" as const, page: pageOf(el) } }))
        .sort((a, b) => a.locator.page - b.locator.page),
    element: (locator) =>
      locator.kind === "page" ? o.root.querySelector<HTMLElement>(`[${PDF_PAGE_ATTR}="${locator.page - 1}"]`) : null,
    scrollTo(place, behavior) {
      if (place.locator.kind !== "page") return;
      const size = o.pageSize(place.locator.page - 1);
      o.scrollToPage({
        pageNumber: place.locator.page,
        pageCoordinates: size && { x: size.width / 2, y: place.offset * size.height },
        alignX: 50,
        alignY: 50,
        behavior,
      });
    },
    label: (locator, fraction) => (locator.kind === "page" ? `On p. ${locator.page}` : percentLabel(fraction)),
  });
}
