import { resolveStorageUrl } from "@/lib/storage/config";
import { parseBookDocument, type BookDocument } from "@/lib/book/schema";
import { buildSectionsById } from "@/lib/reader/sections";
import type { Database } from "@/lib/supabase/database.types";
import { STORAGE_CACHE_SECONDS, fetchMaterialManifest, materialStorageTag } from "./manifest";
import { parseGoogleMetaData, parseOpenLibraryMetaData } from "./providerMeta";

type MaterialRow = Database["public"]["Tables"]["materials"]["Row"];

// Everything `fields=` may request. DB-only fields resolve straight off the
// row; `narrators`/`notes`/a `sections` request that also carries a
// `sectionId` are the only ones that ever touch Storage (api-spec.md § 2).
const DB_ONLY_FIELDS = new Set([
  "title",
  "author",
  "description",
  "cover",
  "coverSource",
  "googleCoverUrl",
  "googleThumbnailUrl",
  "googleDescription",
  "googleMetaData",
  "openlibraryCoverUrl",
  "openlibraryThumbnailUrl",
  "openlibraryDescription",
  "openlibraryMetaData",
  "language",
  "publishedYear",
  "pageCountEstimate",
  "narratorCount",
  "spine",
  "toc_titles",
]);
const STORAGE_FIELDS = new Set(["narrators", "notes"]);

export class MaterialSectionNotFoundError extends Error {}

async function fetchBookFromStorage(jsonStoragePath: string | null, slug: string): Promise<BookDocument> {
  if (!jsonStoragePath) throw new Error("Material has no json_storage_path (PDF materials have no BookDocument)");
  // Next's data cache skips entries over 2MB, so big books still refetch.
  const res = await fetch(resolveStorageUrl(jsonStoragePath), {
    next: { revalidate: STORAGE_CACHE_SECONDS, tags: [materialStorageTag(slug)] },
  });
  if (!res.ok) throw new Error(`Could not fetch book JSON at ${jsonStoragePath} (${res.status})`);
  const parsed = parseBookDocument(await res.json());
  if (!parsed.ok) throw new Error(`Invalid book JSON at ${jsonStoragePath}: ${parsed.error.message}`);
  return parsed.data;
}

/**
 * The `fields=` resolver — given a `materials` row and the requested field
 * list, returns DB-only data immediately; only fetches+parses the full
 * `BookDocument` from Storage when `narrators`, `notes`, or a `sectionId`-
 * scoped `sections` request actually needs it. Isolated here so every route
 * handler that touches a material's projectable fields (the details route
 * today) stays a thin wrapper around this.
 */
export async function projectMaterial(
  row: MaterialRow,
  opts: {
    fields: string[];
    sectionId?: string;
    passagesOnly?: boolean;
    /**
     * Deliberate, documented deviation from api-spec.md's literal `fields=`
     * contract: a `sections` request with no `sectionId` normally returns
     * only the DB-backed TocSection[] outline (no passage content). This
     * flag instead returns the *full* `Section[]` tree (every section, real
     * passages) in one response — used only by the server-side reader-page
     * loaders (lib/materials/toBookDocument.ts), which reconstruct a whole
     * `BookDocument` through this same endpoint/projection rather than
     * bypassing it with a raw Storage fetch. plan.md's Phase 6 "Reader data
     * source" decision: true per-section lazy loading was weighed and
     * deliberately not implemented this pass (search/notes-index/carousel
     * all currently assume the whole book is in memory) — this is the
     * pragmatic middle ground: still routed through the materials table
     * (so an unpublished/nonexistent slug 404s the same way every other
     * materials endpoint does), just not chunked per section on the wire.
     */
    fullContent?: boolean;
  }
): Promise<Record<string, unknown>> {
  const fields = new Set(opts.fields);
  const result: Record<string, unknown> = { id: row.id, slug: row.slug };

  const needsSectionContent = fields.has("sections") && (!!opts.sectionId || !!opts.fullContent);
  const needsStorage = [...fields].some((f) => STORAGE_FIELDS.has(f)) || needsSectionContent;
  const book = needsStorage ? await fetchBookFromStorage(row.json_storage_path, row.slug) : null;
  const manifest = fields.has("spine") || (fields.has("sections") && !needsSectionContent)
    ? await fetchMaterialManifest(row.slug)
    : null;

  for (const field of fields) {
    if (DB_ONLY_FIELDS.has(field)) {
      switch (field) {
        case "title":
          result.title = row.title;
          break;
        case "author":
          result.author = row.author;
          break;
        case "description":
          result.description = row.description;
          break;
        case "cover":
          result.cover = row.cover_url;
          break;
        case "coverSource":
          result.coverSource = row.cover_source;
          break;
        case "googleCoverUrl":
          result.googleCoverUrl = parseGoogleMetaData(row.google_meta_data).coverUrl;
          break;
        case "googleThumbnailUrl":
          result.googleThumbnailUrl = parseGoogleMetaData(row.google_meta_data).thumbnailUrl;
          break;
        case "googleDescription":
          result.googleDescription = parseGoogleMetaData(row.google_meta_data).description;
          break;
        case "googleMetaData":
          result.googleMetaData = row.google_meta_data;
          break;
        case "openlibraryCoverUrl":
          result.openlibraryCoverUrl = parseOpenLibraryMetaData(row.openlibrary_meta_data).coverUrl;
          break;
        case "openlibraryThumbnailUrl":
          result.openlibraryThumbnailUrl = parseOpenLibraryMetaData(row.openlibrary_meta_data).thumbnailUrl;
          break;
        case "openlibraryDescription":
          result.openlibraryDescription = parseOpenLibraryMetaData(row.openlibrary_meta_data).description;
          break;
        case "openlibraryMetaData":
          result.openlibraryMetaData = row.openlibrary_meta_data;
          break;
        case "language":
          result.language = row.language;
          break;
        case "publishedYear":
          result.publishedYear = row.published_year;
          break;
        case "pageCountEstimate":
          result.pageCountEstimate = row.page_count_estimate;
          break;
        case "narratorCount":
          result.narratorCount = row.narrator_count;
          break;
        case "spine":
          result.spine = manifest?.spine ?? row.spine;
          break;
        case "toc_titles":
          result.toc_titles = row.toc_titles;
          break;
      }
      continue;
    }

    if (field === "sections") {
      if (!opts.sectionId && opts.fullContent) {
        // See fullContent's own doc comment above — the real Section[]
        // tree, not the pruned TocSection[] outline.
        result.sections = book!.sections;
        continue;
      }
      if (!opts.sectionId) {
        // Pure DB path — the pruned TocSection[] populated at publish time,
        // no passage content, no Storage round trip.
        result.sections = manifest?.toc ?? row.toc;
        continue;
      }
      // sectionId set — always a Storage read for that one section's real
      // content (api-spec.md: "DB-backed sections only carries the outline
      // shape ... combine with sectionId to fetch that one section's full
      // content").
      const section = buildSectionsById(book!.sections).get(opts.sectionId);
      if (!section) throw new MaterialSectionNotFoundError(opts.sectionId);
      if (opts.passagesOnly) {
        // Top-level key becomes `passages`, not nested under `sections` —
        // "just paragraphs of a specific section" (api-spec.md's example).
        result.passages = section.passages;
      } else {
        result.sections = section;
      }
      continue;
    }

    if (field === "narrators") {
      result.narrators = book!.narrators;
      continue;
    }
    if (field === "notes") {
      // The book's own footnotes/endnotes (BookDocument.notes), NOT
      // community notes — those are a separate endpoint
      // (`GET /api/materials/{materialId}/notes`). Don't conflate the two.
      result.notes = book!.notes;
      continue;
    }
    // Unknown field name — ignored rather than erroring, so a client can
    // request a superset without every route needing to stay in lockstep.
  }

  return result;
}
