import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getMaterialDetail, MaterialNotFoundError, type MaterialDetail } from "@/lib/materials/detail";
import MaterialDetailView from "@/app/components/materials/MaterialDetailView";
import { PLATFORM_NAME, PLATFORM_URL } from "@/lib/config/platform";
import { resolveBookCoverSrc } from "@/lib/materials/image";

// generateMetadata and the page both need the book; load it once per request.
const getDetail = cache(getMaterialDetail);

/** The blurb the page itself shows (MaterialDetailView), as plain text. */
function blurbOf(material: MaterialDetail) {
  const text = material.description ?? material.googleDescription ?? material.openlibraryDescription;
  return text?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  let material;
  try {
    material = await getDetail(slug);
  } catch {
    return { title: "Not found" };
  }
  const { title, author } = material;
  const url = `${PLATFORM_URL}/library/${slug}`;
  const blurb = blurbOf(material);
  const desc = blurb ? (blurb.length > 200 ? `${blurb.slice(0, 197).trimEnd()}…` : blurb) : `${title} by ${author} — read or listen on ${PLATFORM_NAME}.`;
  // The share image comes from ./opengraph-image.tsx (served from our domain).
  return {
    title,
    description: desc,
    alternates: { canonical: url },
    openGraph: { title, description: desc, url, type: "book" },
    twitter: { card: "summary_large_image", title, description: desc },
  };
}

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let material;
  try {
    material = await getDetail(slug);
  } catch (err) {
    if (err instanceof MaterialNotFoundError) {
      notFound();
    }
    throw err;
  }
  const blurb = blurbOf(material);
  const image = resolveBookCoverSrc(material);
  // schema.org Book, so search engines read title/author/cover directly.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Book",
    name: material.title,
    author: { "@type": "Person", name: material.author },
    url: `${PLATFORM_URL}/library/${slug}`,
    ...(image && { image }),
    ...(blurb && { description: blurb }),
    ...(material.publishedYear && { datePublished: String(material.publishedYear) }),
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <MaterialDetailView material={material} />
    </>
  );
}
