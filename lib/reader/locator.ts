import type { BookDocument } from "@/lib/book/schema";
import { buildSectionsById } from "./sections";

/**
 * "Where is this reader in this material" — one shape for every format, and
 * the single place a new format (or a new way of moving through an existing
 * one) gets taught to the progress system.
 *
 * Replaces the old EPUB-only `{sectionId, passageIndex}` pair that both
 * `reader_activities` and reading-position-store were built around: a PDF
 * has no sections, a DOCX/web article has neither sections nor passages, and
 * every consumer of progress (library rows, the continue-reading shelf, the
 * material detail page, the reading-room roster) only ever wanted a
 * percentage and a way to resume — neither of which is EPUB-specific.
 *
 * `kind` is deliberately *not* the material type: it names the addressing
 * scheme, so two formats that move the same way share one (DOCX and web
 * articles are both `block`), and one format could grow a second scheme
 * without a new material type.
 */
export type Locator =
  /** EPUB: a spine section plus the passage within it. */
  | { kind: "epub"; sectionId: string; passageIndex: number }
  /** Paginated documents (PDF): a 1-based page number. */
  | { kind: "page"; page: number }
  /** Reflowable single-document formats (DOCX, extracted web articles): the
   * index of a top-level block in the rendered article. Deliberately an
   * index rather than a scroll offset or fraction — the text reflows with
   * the viewport, which invalidates any pixel- or fraction-based position,
   * while the block sequence itself is stable. */
  | { kind: "block"; blockIndex: number };

export type LocatorKind = Locator["kind"];

/** Reading vs. listening — persisted alongside the locator rather than
 * inferred from the presence of an audio offset (which is what
 * `audioTimeMs != null` used to stand in for), so that listening can be
 * supported for formats whose locators have no audio offset of their own. */
export type ReaderMode = "read" | "listen";

/**
 * Everything needed to turn a `Locator` into a 0-100 percentage: the total
 * extent of the material, in whatever unit that locator addresses. One
 * variant per `Locator` kind, matched on `kind`.
 *
 * Per-kind availability differs, and that's inherent rather than an
 * oversight: an EPUB's shape is known server-side from its spine, a PDF's
 * page count only once the document has loaded in the viewer, and a
 * reflowable document's block count only once it has actually rendered. So
 * callers treat this as "known eventually", and a commit made before it is
 * known simply reports 0.
 */
export type LocatorScale =
  | { kind: "epub"; spine: string[]; sectionPassageCounts: Record<string, number> }
  | { kind: "page"; pageCount: number }
  | { kind: "block"; blockCount: number };

/**
 * An EPUB's scale, derived from its spine order plus each section's passage
 * *count* (not its content) — so a caller that only needs a progress bar
 * never has to ship full book text to the client to get one.
 */
export function buildEpubScale(book: Pick<BookDocument, "sections" | "spine">): Extract<LocatorScale, { kind: "epub" }> {
  const sectionPassageCounts: Record<string, number> = {};
  for (const [id, section] of buildSectionsById(book.sections)) {
    sectionPassageCounts[id] = section.passages.length;
  }
  return { kind: "epub", spine: book.spine, sectionPassageCounts };
}

/** Clamped 0-1. */
const fraction = (value: number, total: number) => (total > 0 ? Math.min(1, Math.max(0, value / total)) : 0);

/**
 * A 0-100 "how far through this material" figure, for every context with no
 * mounted viewer to ask (a library row, the continue-reading shelf) —
 * computed from the same saved locator the viewer itself resumes from.
 *
 * Returns 0 whenever the locator and the scale disagree on `kind` (a
 * material re-ingested into a different format, say) rather than guessing:
 * the viewer's own first commit will correct it moments later.
 */
export function locatorPercent(scale: LocatorScale | undefined, locator: Locator | undefined): number {
  if (!scale || !locator || scale.kind !== locator.kind) return 0;

  switch (locator.kind) {
    case "epub": {
      // Spine index plus an intra-section fraction, over the whole spine —
      // deliberately the same shape as useSectionCarousel's own `scrollPct`
      // (which uses scrollTop/scrollHeight as the intra-section fraction
      // rather than passageIndex/passageCount), so this figure stays
      // conceptually consistent with whatever percentage the reader itself
      // shows once actually open.
      const epubScale = scale as Extract<LocatorScale, { kind: "epub" }>;
      const spineIndex = epubScale.spine.indexOf(locator.sectionId);
      if (spineIndex < 0) return 0;
      const intra = fraction(locator.passageIndex, epubScale.sectionPassageCounts[locator.sectionId] ?? 0);
      return Math.round(fraction(spineIndex + intra, epubScale.spine.length) * 100);
    }
    // Page 1 of 10 is the *start* of the document, not 10% of the way in —
    // the same "index, not count" reasoning as passageIndex above.
    case "page":
      return Math.round(fraction(locator.page - 1, (scale as Extract<LocatorScale, { kind: "page" }>).pageCount) * 100);
    case "block":
      return Math.round(fraction(locator.blockIndex, (scale as Extract<LocatorScale, { kind: "block" }>).blockCount) * 100);
  }
}

/**
 * The percentage to *show* for a saved position — 100 for anything the reader
 * has explicitly finished, the tracked figure otherwise.
 *
 * Completion can't come out of `locatorPercent`: that divides an index by a
 * count, so the final passage/page/block always lands just short of 100, and
 * deliberately so — "looking at the last unit" isn't the claim "I read this".
 * The two facts are stored separately for the same reason (`finished_at` next
 * to `progress_percent`), which also means un-finishing restores the honest
 * number rather than a fabricated one, and "Read again" can still resume from
 * the real locator.
 */
export function positionPercent(position: { progressPercent: number; finishedAt?: string | null } | undefined): number {
  if (!position) return 0;
  return position.finishedAt ? 100 : position.progressPercent;
}

export function sameLocator(a: Locator | undefined, b: Locator | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  switch (a.kind) {
    case "epub":
      return a.sectionId === (b as typeof a).sectionId && a.passageIndex === (b as typeof a).passageIndex;
    case "page":
      return a.page === (b as typeof a).page;
    case "block":
      return a.blockIndex === (b as typeof a).blockIndex;
  }
}

/**
 * Runtime narrowing for a `Locator` arriving from somewhere untyped — a
 * request body (`PUT /auth/me/reading-position`), a `jsonb` column, or this
 * device's own localStorage. Every such boundary validates here rather than
 * casting, so one malformed record can't propagate into progress maths.
 */
export function isLocator(value: unknown): value is Locator {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case "epub":
      return typeof v.sectionId === "string" && Number.isInteger(v.passageIndex);
    case "page":
      return Number.isInteger(v.page);
    case "block":
      return Number.isInteger(v.blockIndex);
    default:
      return false;
  }
}

export function isReaderMode(value: unknown): value is ReaderMode {
  return value === "read" || value === "listen";
}

/** Narrows a locator to one expected kind — how a viewer rejects a stored
 * position addressed in a scheme it can't act on. */
export function locatorOfKind<K extends LocatorKind>(
  locator: Locator | undefined,
  kind: K
): Extract<Locator, { kind: K }> | undefined {
  return locator?.kind === kind ? (locator as Extract<Locator, { kind: K }>) : undefined;
}

/**
 * Query-string form of a locator, and its inverse — the one definition of
 * how a resume link carries a position through a URL.
 *
 * Resume links hand the position over *in the URL* rather than letting the
 * viewer read it back off this device's local mirror on arrival: the mirror
 * is exactly the thing that can disagree with the server (right after login,
 * before `GET /continue-reading` has landed), and the linking page already
 * holds the reader's real `reader_activities` row when it renders the link.
 * See useResumeScroll's own doc comment for the full story.
 */
export type LocatorQuery = { section?: string; passageIndex?: string; page?: string; block?: string };

export function locatorToQuery(locator: Locator): Record<string, string> {
  switch (locator.kind) {
    case "epub":
      return { section: locator.sectionId, passageIndex: String(locator.passageIndex) };
    case "page":
      return { page: String(locator.page) };
    case "block":
      return { block: String(locator.blockIndex) };
  }
}

const parseIndex = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
};

export function locatorFromQuery(query: LocatorQuery): Locator | undefined {
  const page = parseIndex(query.page);
  if (page !== undefined) return { kind: "page", page };
  const blockIndex = parseIndex(query.block);
  if (blockIndex !== undefined) return { kind: "block", blockIndex };
  // `?section=` alone is also a plain chapter link (the material detail
  // page's outline rows), which is a *navigation* target rather than a
  // resume position — callers that care about the difference look at
  // `?passageIndex=`'s presence, exactly as they did before this module
  // existed. Represented here as passageIndex 0, the same default that
  // link has always meant.
  if (query.section) return { kind: "epub", sectionId: query.section, passageIndex: parseIndex(query.passageIndex) ?? 0 };
  return undefined;
}

/**
 * The canonical "take me back to where I was" URL for a material — used by
 * every resume affordance (the continue-reading rail, the Reading page's
 * rows, the material detail page's CTA) so they can't drift apart.
 * `listen=1` carries the mode, which is what keeps a reader who was
 * listening from being dropped back into text.
 */
export function buildResumeHref(slug: string, position: { locator: Locator; mode: ReaderMode }): string {
  const query = new URLSearchParams(locatorToQuery(position.locator));
  if (position.mode === "listen") query.set("listen", "1");
  return `/read/${slug}?${query.toString()}`;
}
