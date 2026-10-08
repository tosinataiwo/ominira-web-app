import type { BookDocument } from "@/lib/book/schema";
import { buildEpubScale, type Locator, type LocatorScale } from "@/lib/reader/locator";

/**
 * What narration reads, whatever the format: sections of passages in spine
 * order, plus what the player bar and lock screen show. An EPUB's
 * BookDocument already is one; PDF, DOCX and web pages build one from their
 * own text, so the engine, queue, cache and highlighting stay one
 * implementation (lib/audio/) for every format.
 */
export type NarrationDocument = Pick<BookDocument, "id" | "slug" | "sections" | "spine"> & {
  metadata: { title: string; author?: string; cover?: string };
  /** How the format saves positions, when that isn't EPUB's section +
   * passage. A `block` document is one section whose passage i is block i;
   * a `page` document has one section per page, in page order. */
  scale?: Extract<LocatorScale, { kind: "block" | "page" }>;
};

/** Where listening has got to, in the format's own locator — so listening
 * and scrolling save and resume the same position. */
export function listenLocator(doc: NarrationDocument, sectionId: string, passageIndex: number): Locator {
  switch (doc.scale?.kind) {
    case "block":
      return { kind: "block", blockIndex: passageIndex };
    case "page":
      return { kind: "page", page: doc.spine.indexOf(sectionId) + 1 };
    default:
      return { kind: "epub", sectionId, passageIndex };
  }
}

/** The inverse: the section and passage a saved position points at, or
 * undefined when it was saved in another format's terms. */
export function locatorPlace(
  doc: NarrationDocument,
  locator: Locator | undefined
): { sectionId: string; passageIndex: number } | undefined {
  if (!locator || locator.kind !== (doc.scale?.kind ?? "epub")) return undefined;
  switch (locator.kind) {
    case "block":
      return { sectionId: doc.spine[0], passageIndex: locator.blockIndex };
    case "page": {
      const sectionId = doc.spine[locator.page - 1];
      return sectionId ? { sectionId, passageIndex: 0 } : undefined;
    }
    case "epub":
      return { sectionId: locator.sectionId, passageIndex: locator.passageIndex };
  }
}

export function narrationScale(doc: NarrationDocument): LocatorScale {
  return doc.scale ?? buildEpubScale(doc);
}
