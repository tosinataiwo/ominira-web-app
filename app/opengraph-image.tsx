import { ImageResponse } from "next/og";
import { BRAND_BG } from "@/lib/config/brand-assets";
import { OG_SIZE, brandImage } from "@/lib/config/og";

// Site-wide share card (X, WhatsApp, iMessage…). Next adds og:image for every
// route that doesn't set its own; X falls back to og:image when there's no
// twitter:image. Static, so it's rendered once at build.
export const alt = "Ominira — Arise for Freedom";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const [mark, wordmark] = await Promise.all([brandImage("splash-icon-512.png"), brandImage("wordmark-light.png")]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_BG.light,
        }}
      >
        {/* Both PNGs carry their own cream padding, so they sit close. */}
        <img src={mark} width={420} height={420} alt="" />
        <img src={wordmark} width={680} height={270} alt="" />
      </div>
    ),
    size,
  );
}
