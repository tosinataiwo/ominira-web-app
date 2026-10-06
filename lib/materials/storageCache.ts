import { revalidateTag } from "next/cache";
import { storageCacheTag } from "@/lib/storage/filebase";
import { manifestStoragePath } from "./manifest";

/** Drops the year-long data-cache entries for a slug's book JSON and
 * manifest (see STORAGE_CACHE_SECONDS) — immediately, not
 * stale-while-revalidate, since the old content may belong to a different
 * book. */
export function invalidateMaterialStorage(slug: string): void {
  revalidateTag(storageCacheTag(`books/${slug}.json`), { expire: 0 });
  revalidateTag(storageCacheTag(manifestStoragePath(slug)), { expire: 0 });
}
