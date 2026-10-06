import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseBookDocument, type BookDocument } from "./schema";
import { readStorageText } from "@/lib/storage/filebase";

const BOOKS_DIR = path.join(process.cwd(), "content", "books");
const BOOKS_SOURCE = process.env.BOOKS_SOURCE ?? "local";

export class BookNotFoundError extends Error {
  constructor(slug: string) {
    super(`No book found for slug "${slug}"`);
    this.name = "BookNotFoundError";
  }
}

export class BookValidationError extends Error {
  constructor(slug: string, issues: string) {
    super(`Book "${slug}" failed schema validation:\n${issues}`);
    this.name = "BookValidationError";
  }
}

function parseRaw(slug: string, raw: string): BookDocument {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new BookValidationError(slug, `not valid JSON (${(err as Error).message})`);
  }

  const parsed = parseBookDocument(json);
  if (!parsed.ok) {
    throw new BookValidationError(slug, parsed.error.message);
  }
  return parsed.data;
}

/**
 * Reads a book straight off local disk, ignoring BOOKS_SOURCE. Used by
 * getBookDocument's local branch, and by the publish script — whose job is
 * always "read what's on disk and push it", regardless of how the running
 * app happens to be configured to read books.
 */
export async function getLocalBookDocument(slug: string): Promise<BookDocument> {
  let raw: string;
  try {
    raw = await readFile(path.join(BOOKS_DIR, `${slug}.json`), "utf-8");
  } catch {
    throw new BookNotFoundError(slug);
  }
  return parseRaw(slug, raw);
}

/**
 * Reads and validates a book by slug. Source is local JSON fixtures or a
 * published Filebase bucket, chosen by BOOKS_SOURCE — callers and
 * the return type are identical either way.
 */
export async function getBookDocument(slug: string): Promise<BookDocument> {
  if (BOOKS_SOURCE !== "supabase") {
    return getLocalBookDocument(slug);
  }
  const raw = await readStorageText(`books/${slug}.json`).catch(() => {
    throw new BookNotFoundError(slug);
  });
  return parseRaw(slug, raw);
}

/**
 * Persists a book back to its JSON fixture — used by the audio admin panel
 * to write generated narration tracks in place. Validates before writing so
 * a bad in-memory mutation can't corrupt the file on disk.
 */
export async function writeBookDocument(slug: string, doc: BookDocument): Promise<void> {
  const parsed = parseBookDocument(doc);
  if (!parsed.ok) {
    throw new BookValidationError(slug, parsed.error.message);
  }
  await writeFile(path.join(BOOKS_DIR, `${slug}.json`), `${JSON.stringify(parsed.data, null, 2)}\n`, "utf-8");
}

/** Every book slug present on local disk — always local, regardless of BOOKS_SOURCE. */
export async function listLocalBookSlugs(): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(BOOKS_DIR);
  } catch {
    return [];
  }
  return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
}

/**
 * Lists every published book for the library index. A book that fails to
 * read or validate is skipped (and logged) rather than taking the whole
 * listing down — one bad file/object shouldn't 500 the homepage.
 *
 * Plain sequential reads off local disk, no caching layer — this is a
 * placeholder repository backed by JSON fixtures, about to be replaced by
 * real API/database calls once those modules exist. Optimizing this
 * implementation now (response caching, parallel fan-out, etc.) is work
 * that gets thrown away with it; keeping it as the simplest version that
 * obviously works is what actually matters until then.
 */
export async function listBooks(): Promise<BookDocument[]> {
  let slugs: string[];
  if (BOOKS_SOURCE === "supabase") {
    try {
      slugs = JSON.parse(await readStorageText("books/index.json")) as string[];
    } catch {
      slugs = [];
    }
  } else {
    slugs = await listLocalBookSlugs();
  }

  const books: BookDocument[] = [];
  for (const slug of slugs) {
    try {
      books.push(await getBookDocument(slug));
    } catch (err) {
      console.error(`Skipping ${slug} in library listing: ${(err as Error).message}`);
    }
  }
  return books;
}
