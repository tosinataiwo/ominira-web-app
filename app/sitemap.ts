import type { MetadataRoute } from "next";
import { PLATFORM_URL } from "@/lib/config/platform";
import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";

// Rebuilt at most hourly, so newly published books show up without a deploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await getSupabaseAdminClient()
    .from("materials")
    .select("slug, updated_at")
    .eq("status", "published");

  return [
    { url: `${PLATFORM_URL}/home`, changeFrequency: "daily", priority: 1 },
    { url: `${PLATFORM_URL}/library`, changeFrequency: "daily", priority: 0.9 },
    ...(data ?? []).map((book) => ({
      url: `${PLATFORM_URL}/library/${book.slug}`,
      lastModified: book.updated_at ?? undefined,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
