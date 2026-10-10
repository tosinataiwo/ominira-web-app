"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { domToBlob } from "modern-screenshot";
import { PLATFORM_HOST, PLATFORM_NAME } from "@/lib/config/platform";
import { SPLASH_MARK } from "@/lib/config/brand-assets";

type Props = {
  quote: string;
  author?: string;
  bookTitle: string;
  onClose: () => void;
};

/** Strips a trailing "; " left over from multi-author source metadata that
 * only ever resolved to one name here (e.g. "Cedric J. Robinson;") — purely
 * a display cleanup for this card, not a fix to the underlying data, so it
 * doesn't touch how the author renders anywhere else in the app. */
function cleanAuthor(author: string): string {
  return author.replace(/[;,\s]+$/, "");
}

const EXPORT_FILENAME = "ominira-quote.png";

// Instagram's own standard square upload size — every export is
// rasterized at this resolution regardless of the on-screen card's own
// (possibly smaller, on a narrow phone) CSS size; see renderBlob.
const EXPORT_SIZE = 1080;

async function renderBlob(node: HTMLElement): Promise<Blob> {
  const scale = EXPORT_SIZE / node.getBoundingClientRect().width;
  return domToBlob(node, { scale, backgroundColor: getComputedStyle(node).backgroundColor });
}


export default function ShareQuoteModal({ quote, author, bookTitle, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const [isMobile, setIsMobile] = useState(false);
 
  const [canShareFiles] = useState(
    () =>
      typeof navigator.share === "function" &&
      navigator.canShare?.({ files: [new File([], EXPORT_FILENAME, { type: "image/png" })] }) === true
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onDownload = async () => {
    if (!cardRef.current || busy) return;
    setBusy("download");
    try {
      const blob = await renderBlob(cardRef.current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = EXPORT_FILENAME;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  };

  const onShare = async () => {
    if (!cardRef.current || busy) return;
    setBusy("share");
    try {
      const blob = await renderBlob(cardRef.current);
      const file = new File([blob], EXPORT_FILENAME, { type: "image/png" });
      await navigator.share({ files: [file] });
    } catch {
      // Reader dismissed the native share sheet — not an error.
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      onClick={onClose}
      className={`w-full h-full box-border bg-black/45 flex justify-center ${
        isMobile ? "items-stretch p-0" : "items-center py-10 px-6"
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full bg-[var(--reader-surface)] shadow-lg flex flex-col box-border overflow-hidden ${
          isMobile ? "h-full rounded-none" : "max-w-[860px] max-h-[90vh] rounded-lg"
        }`}
      >
        <div className="flex flex-none items-center justify-between border-b border-[var(--reader-border)] px-4 py-3.5">
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex cursor-pointer items-center justify-center border-none bg-transparent text-[var(--reader-text)]"
          >
            <X size={20} />
          </button>
          <span className="text-sm font-bold text-[var(--reader-text)]">Share</span>
          <div className="flex items-center gap-4">
            <button
              onClick={onDownload}
              disabled={busy !== null}
              aria-label="Download image"
              className="flex cursor-pointer items-center justify-center border-none bg-transparent text-[var(--reader-text)] disabled:cursor-default disabled:opacity-40"
            >
              <Download size={20} />
            </button>
            {canShareFiles && (
              <button
                onClick={onShare}
                disabled={busy !== null}
                aria-label="Share image"
                className="flex cursor-pointer items-center justify-center border-none bg-transparent text-[var(--reader-text)] disabled:cursor-default disabled:opacity-40"
              >
                <Share size={20} />
              </button>
            )}
          </div>
        </div>

        {/* max-w-[640px]: the largest square that still safely fits every
            desktop-mode viewport (≥768px — see isMobile) at this dialog's
            max-w-[860px]. On mobile the dialog is already full viewport
            width, so max-w-[640px] never even applies there — the card is
            capped by the viewport itself (a square can't be wider than the
            screen), and this wrapper's own padding is the one remaining
            thing eating into that. p-2 (not md:p-4's 16px) is deliberately
            tighter on mobile for exactly that reason: every px reclaimed
            here is a px the card actually gets, unlike on desktop where
            there's slack to spare either way.
            The quote's line-clamp is capped separately per breakpoint
            (below) since a fixed line count can't be right for both a
            mobile card and a 640px desktop one at the same font size — a
            bigger card only shows more text if the clamp is raised to
            match it. */}
        <div className="flex flex-1 items-center justify-center overflow-hidden p-2 md:p-4">
          <div
            ref={cardRef}
            style={{ background: "var(--color-sand-50)" }}
            className="relative flex aspect-square w-full max-w-[640px] flex-none flex-col overflow-hidden px-6 py-7 text-left"
          >
            <span
              aria-hidden="true"
              className="mb-2 flex-none select-none font-serif text-[24px] leading-none text-[var(--color-brand-200)]"
            >
              &ldquo;
            </span>

            <div className="min-h-0 flex-1 overflow-hidden">
              <p className="m-0 line-clamp-[6] font-serif text-[18px] leading-[1.4] text-[var(--color-sand-900)] md:line-clamp-[16]">
                {quote}
              </p>
            </div>

            {/* Brand watermark, placed right under the quote (not buried in
                the footer) so it stays legible even when a share sheet or
                social app crops the card's bottom edge. Sized to read at a
                glance in a social feed thumbnail, not just up close. */}
            <div aria-hidden="true" className="flex flex-none items-center gap-2.5 pt-5">
              <img
                src={SPLASH_MARK.light}
                alt=""
                width={32}
                height={31}
                className="h-[31px] w-auto"
              />
              <span className="text-[19px] font-serif font-bold uppercase tracking-[0.1em] text-[var(--color-brand-600)]">
                {PLATFORM_NAME}
              </span>
            </div>

            <div className="flex flex-none flex-col gap-1 pt-5">
              <p className="m-0 text-[13px] font-medium text-[var(--color-sand-500)]">
                {bookTitle}{author ? ` - ${cleanAuthor(author)}` : ""}
              </p>
              <p className="m-0 text-[11px] font-semibold tracking-[0.16em] text-[var(--color-sand-400)]">
                {PLATFORM_HOST}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
