import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Share-card size X, WhatsApp and Facebook all show uncropped (1.91:1). */
export const OG_SIZE = { width: 1200, height: 630 };

/** A public/icons PNG as a data URL, for next/og ImageResponse. */
export async function brandImage(name: string) {
  const data = await readFile(join(process.cwd(), "public/icons", name));
  return `data:image/png;base64,${data.toString("base64")}`;
}
