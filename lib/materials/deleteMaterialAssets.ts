import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import { invalidateMaterialStorage } from "./storageCache";
import { STORAGE_BUCKET } from "@/lib/storage/config";

/** Escapes a slug for use inside a RegExp — slugs are URL-safe already, but
 * this stays correct even if that ever changes. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LIST_PAGE_SIZE = 1000;

/** `list()` defaults to a 100-item page — `covers/` alone holds two objects
 * per book across the whole catalogue (400+ books today), and a single
 * audiobook's `audio/<slug>/` folder can easily carry more chapters than
 * that too. Paginate until a short page confirms there's nothing left,
 * rather than silently acting on only the first page. */
async function listAll(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  folder: string,
  search?: string
): Promise<{ names: string[]; error: string | null }> {
  const names: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage.from(STORAGE_BUCKET).list(folder, { limit: LIST_PAGE_SIZE, offset, search });
    if (error) return { names, error: error.message };
    for (const entry of data ?? []) names.push(entry.name);
    if (!data || data.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
  return { names, error: null };
}

/**
 * Removes every Storage object a published book owns, by slug — everything
 * `Archive/scripts/publish-book.ts` writes under the `library` bucket for a
 * given slug: its JSON blob and manifest (`books/`), original cover and
 * generated thumbnail (`covers/`, whichever extension — see
 * generate-material-thumbnails.ts), in-book images (`images/<slug>/`), and
 * narration audio (`audio/<slug>/`). Deliberately never touches
 * `books/index.json` — that's a shared cross-book index, not this book's.
 *
 * Best-effort: called after the `materials` row is already gone (the DB
 * delete is the one that actually makes a book disappear), so a partial
 * failure here just leaves orphaned files behind rather than blocking or
 * reversing the delete the admin already confirmed.
 */
export async function deleteMaterialAssets(slug: string): Promise<{ removed: string[]; errors: string[] }> {
  const admin = getSupabaseAdminClient();
  const errors: string[] = [];
  invalidateMaterialStorage(slug);
  const paths: string[] = [`books/${slug}.json`, `books/${slug}-manifest.json`];

  // Cover + thumbnail: extension varies (whatever the source image was), and
  // the thumbnail is a distinct "<slug>-thumbnail.webp" object. `search`
  // narrows the (shared, catalogue-wide) covers folder server-side first;
  // the regex then still requires an exact slug match (not a prefix) so a
  // slug that's a prefix of another one (e.g. "foo" vs "foo-bar") can never
  // catch the wrong book's files.
  const coverNamePattern = new RegExp(`^${escapeRegExp(slug)}(-thumbnail)?\\.[^./]+$`);
  const { names: coverNames, error: coverListError } = await listAll(admin, "covers", slug);
  if (coverListError) errors.push(`list covers: ${coverListError}`);
  for (const name of coverNames) {
    if (coverNamePattern.test(name)) paths.push(`covers/${name}`);
  }

  // In-book images and narration audio each live in their own slug-named
  // folder — list() is folder-exact (not a raw string prefix), so this can't
  // spill into a differently-named sibling folder either.
  for (const folder of [`images/${slug}`, `audio/${slug}`]) {
    const { names, error: listError } = await listAll(admin, folder);
    if (listError) {
      errors.push(`list ${folder}: ${listError}`);
      continue;
    }
    for (const name of names) paths.push(`${folder}/${name}`);
  }

  if (paths.length === 0) return { removed: [], errors };

  // remove() also caps at 1000 paths per call — chunk defensively even
  // though a single book landing on that many objects is unlikely.
  const removed: string[] = [];
  for (let i = 0; i < paths.length; i += LIST_PAGE_SIZE) {
    const chunk = paths.slice(i, i + LIST_PAGE_SIZE);
    const { data, error: removeError } = await admin.storage.from(STORAGE_BUCKET).remove(chunk);
    if (removeError) errors.push(`remove: ${removeError.message}`);
    for (const file of data ?? []) removed.push(file.name);
  }

  return { removed, errors };
}
