import type { MetadataRoute } from "next";
import { PLATFORM_URL } from "@/lib/config/platform";

// Without this, /robots.txt rendered the HTML not-found page with a 200,
// which link-preview crawlers like Twitterbot may not read as "allow".
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/admin"] },
    sitemap: `${PLATFORM_URL}/sitemap.xml`,
  };
}
