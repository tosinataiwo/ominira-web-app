import { revalidateTag } from "next/cache";
import { materialStorageTag } from "./manifest";

/** Drops the year-long data-cache entries for a slug's Storage objects (see
 * STORAGE_CACHE_SECONDS) — immediately, not stale-while-revalidate, since
 * the old content may belong to a different book. */
export function invalidateMaterialStorage(slug: string): void {
  revalidateTag(materialStorageTag(slug), { expire: 0 });
}
