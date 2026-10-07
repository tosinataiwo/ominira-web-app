import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import type { Database } from "@/lib/supabase/database.types";
import { MATERIAL_DETAIL_COLUMNS } from "./columns";

type MaterialRow = Database["public"]["Tables"]["materials"]["Row"];

export const UUID_RE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a materialId path segment against either `id` (UUID) or `slug`
 * (api-spec.md's Conventions: "tried as id::text = $1 or slug = $1"). Picks
 * the column by shape rather than a real SQL `or()` filter — `id` is a
 * `uuid` column, so comparing it against a non-UUID slug string errors at
 * the Postgres level (invalid input syntax) before the `slug` branch ever
 * gets a chance to match; it isn't a graceful per-row fallback the way an
 * `or()` over two same-typed columns would be.
 */
export async function resolveMaterialRow(
  materialId: string,
  opts: { publishedOnly?: boolean } = {}
): Promise<MaterialRow | null> {
  const { publishedOnly = true } = opts;
  const column = UUID_RE.test(materialId) ? "id" : "slug";
  let query = getSupabaseAdminClient()
    .from("materials")
    .select(MATERIAL_DETAIL_COLUMNS)
    .eq(column, materialId);
  if (publishedOnly) query = query.eq("status", "published");
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  // The resolver intentionally projects out the retired TOC/spine payloads;
  // callers that need navigation use the Storage manifest instead.
  return data as unknown as MaterialRow;
}
