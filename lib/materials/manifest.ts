import { readStorageText } from "@/lib/storage/filebase";
import { sectionLabel } from "@/lib/reader/sectionHeading";
import type { BookDocument, Section } from "@/lib/book/schema";
import type { TocSection } from "@/lib/api/types";

export type MaterialManifest = {
  schemaVersion: 1;
  slug: string;
  toc: TocSection[];
  spine: string[];
};

export function manifestStoragePath(slug: string): string {
  return `books/${slug}-manifest.json`;
}

function buildToc(sections: Section[]): TocSection[] {
  return sections.map((section) => {
    const tracks = section.audio?.narratorTracks ?? [];
    const firstTrack = tracks[0];
    return {
      id: section.id,
      label: sectionLabel(section),
      kind: section.kind,
      passageCount: section.passages.length,
      children: buildToc(section.children),
      ...(firstTrack ? { audioDurationMs: firstTrack.durationMs } : {}),
      ...(tracks.length ? { narratorIds: tracks.map((track) => track.narratorId) } : {}),
    };
  });
}

/** Builds the compact navigation manifest a parsed/validated BookDocument
 * should get in Storage (`manifestStoragePath`) — the single shape
 * scripts/generate-material-manifests.ts (batch backfill),
 * app/api/materials/upload/route.ts (written inline, right after a reader's
 * EPUB upload validates — a material with no manifest object is what makes
 * fetchMaterialManifest below 404 on the book detail page), and
 * scripts/parse-local.ts's own local preview all build the same way.
 * `slug` defaults to the document's own (`book.slug`, generated client-side
 * from the source filename — see epubParser's `slugHint`), but the upload
 * route passes the *materials row's* final slug explicitly instead: that
 * one is generated server-side from the title and de-duplicated
 * (uniqueSlug), so it can differ from the document's own, and the manifest
 * must carry whichever one fetchMaterialManifest will actually look it up
 * by. */
export function buildMaterialManifest(book: BookDocument, slug: string = book.slug): MaterialManifest {
  return { schemaVersion: 1, slug, toc: buildToc(book.sections), spine: book.spine };
}

export async function fetchMaterialManifest(slug: string): Promise<MaterialManifest> {
  // Cached for a year (readStorageText); a slug freed by a delete and handed
  // to a new book by uniqueSlug is cleared by invalidateMaterialStorage.
  const text = await readStorageText(manifestStoragePath(slug)).catch((err: Error) => {
    throw new Error(`Could not fetch material manifest for ${slug} (${err.message})`);
  });
  const value = JSON.parse(text) as Partial<MaterialManifest>;
  if (value.schemaVersion !== 1 || value.slug !== slug || !Array.isArray(value.toc) || !Array.isArray(value.spine)) {
    throw new Error(`Invalid material manifest for ${slug}`);
  }
  return value as MaterialManifest;
}
