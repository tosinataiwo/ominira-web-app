import { ImageResponse } from "next/og";
import { BRAND_BG } from "@/lib/config/brand-assets";
import { OG_SIZE, brandImage } from "@/lib/config/og";
import { resolveMaterialRow } from "@/lib/materials/resolve";
import { projectMaterial } from "@/lib/materials/projection";
import { resolveBookCoverSrc } from "@/lib/materials/image";

// A book's share card, served from our own domain: X won't reliably fetch the
// Supabase cover URL, and crops a 2:3 cover to a thin strip in a large card.
export const alt = "Book on Ominira";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 86400;

/** The cover as a data URL, or null if it's missing or a format next/og can't draw. */
async function loadCover(url: string | null) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(jpeg|png)/.test(type)) return null;
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = await resolveMaterialRow(slug);
  const book = row
    ? await projectMaterial(row, {
        fields: ["title", "author", "cover", "coverSource", "openlibraryCoverUrl", "googleCoverUrl"],
      })
    : null;
  const [cover, wordmark] = await Promise.all([
    // Same pick as the page's hero cover: our upload, else OpenLibrary/Google.
    loadCover(book ? resolveBookCoverSrc(book) : null),
    brandImage("wordmark-light.png"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 64,
          padding: "0 80px",
          background: BRAND_BG.light,
          color: "#1c1917",
        }}
      >
        {cover && (
          <img
            src={cover}
            width={340}
            height={510}
            alt=""
            style={{ objectFit: "cover", borderRadius: 8, boxShadow: "0 12px 32px rgba(0,0,0,0.25)" }}
          />
        )}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 20 }}>
          <div style={{ display: "block", fontSize: 60, fontWeight: 700, lineHeight: 1.1, lineClamp: 4 }}>
            {(book?.title as string) ?? "Ominira"}
          </div>
          {book?.author ? <div style={{ fontSize: 34, color: "#57534e" }}>{book.author as string}</div> : null}
          <img src={wordmark} width={300} height={119} alt="" style={{ marginLeft: -30 }} />
        </div>
      </div>
    ),
    size,
  );
}
