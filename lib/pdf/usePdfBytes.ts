"use client";

import { useEffect, useState } from "react";
import { cacheDocument, readCachedDocument } from "@/lib/offline/documentCache";

/** Why a PDF couldn't be fetched — distinguished because the reader says
 * different things for each: a network problem is worth retrying, a file that
 * isn't a PDF is not. */
export type PdfFetchErrorKind = "network" | "not-pdf";

export class PdfFetchError extends Error {
  constructor(
    readonly kind: PdfFetchErrorKind,
    message: string
  ) {
    super(message);
    this.name = "PdfFetchError";
  }
}

/** A PDF's header may be preceded by junk (the spec tolerates up to 1KB of it,
 * and real files lean on that), so the signature is looked for, not assumed at
 * byte 0. */
const HEADER_SEARCH_BYTES = 1024;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function looksLikePdf(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, HEADER_SEARCH_BYTES));
  outer: for (let i = 0; i <= bytes.length - PDF_SIGNATURE.length; i++) {
    for (let j = 0; j < PDF_SIGNATURE.length; j++) if (bytes[i + j] !== PDF_SIGNATURE[j]) continue outer;
    return true;
  }
  return false;
}

/** Bytes received so far, and the total when the server said (Content-Length). */
export type PdfDownloadProgress = { loaded: number; total: number | null };

/** How often progress is reported — often enough to read as live, rarely
 * enough that a fast connection doesn't re-render the reader per network chunk. */
const PROGRESS_INTERVAL_MS = 150;

const NETWORK_ERROR = "The document couldn't be downloaded. Check your connection and try again.";

async function fetchPdf(
  url: string,
  signal: AbortSignal,
  onProgress: (progress: PdfDownloadProgress) => void
): Promise<ArrayBuffer> {
  const cached = await readCachedDocument(url);
  if (cached && looksLikePdf(cached)) return cached;
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new PdfFetchError("network", NETWORK_ERROR);
  }
  if (!response.ok) {
    throw new PdfFetchError("network", `The document couldn't be downloaded (HTTP ${response.status}).`);
  }

  // Read as a stream, so a large file shows how far along it is instead of an
  // unexplained wait. A body-less response (or no stream support) falls back to
  // reading it whole.
  const length = Number(response.headers.get("content-length"));
  const total = Number.isFinite(length) && length > 0 ? length : null;
  let buffer: ArrayBuffer;
  try {
    if (!response.body) {
      buffer = await response.arrayBuffer();
    } else {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      let lastReport = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        const now = Date.now();
        if (now - lastReport >= PROGRESS_INTERVAL_MS) {
          lastReport = now;
          onProgress({ loaded, total });
        }
      }
      const bytes = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      buffer = bytes.buffer;
    }
  } catch (error) {
    if (signal.aborted) throw error;
    throw new PdfFetchError("network", NETWORK_ERROR);
  }

  if (buffer.byteLength === 0 || !looksLikePdf(buffer)) {
    throw new PdfFetchError("not-pdf", "This file isn't a readable PDF.");
  }
  cacheDocument(url, buffer, "application/pdf");
  return buffer;
}

/**
 * The document's bytes, fetched here rather than by passing the URL to EmbedPDF.
 * EmbedPDF's own URL loader hands whatever comes back straight to PDFium without
 * looking at the status, so a 404 or an expired link surfaced as "this PDF is
 * corrupt" — here it's a download error the reader can retry, and a file that
 * isn't a PDF at all is caught before PDFium ever sees it.
 *
 * Runs alongside the engine's startup rather than after it: both are mostly
 * network, so the reader waits for the slower of the two, not their sum.
 * `generation` refetches, for Retry. Opened once, a document is read from the
 * device's copy (lib/offline/documentCache.ts) from then on, online or not.
 */
export function usePdfBytes(url: string, generation: number) {
  const [state, setState] = useState<{
    buffer: ArrayBuffer | null;
    error: Error | null;
    progress: PdfDownloadProgress | null;
  }>({ buffer: null, error: null, progress: null });

  useEffect(() => {
    const controller = new AbortController();
    fetchPdf(url, controller.signal, (progress) => {
      if (!controller.signal.aborted) setState((s) => ({ ...s, progress }));
    }).then(
      (buffer) => {
        if (!controller.signal.aborted) setState({ buffer, error: null, progress: null });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ buffer: null, error: error instanceof Error ? error : new Error(String(error)), progress: null });
      }
    );
    return () => {
      controller.abort();
      setState({ buffer: null, error: null, progress: null });
    };
  }, [url, generation]);

  return state;
}

export type PdfDownload = ReturnType<typeof usePdfBytes>;

/** "2.1 of 5.7 MB" — or just "2.1 MB" when the server didn't give a size. */
export function formatDownloadProgress({ loaded, total }: PdfDownloadProgress) {
  const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
  return total ? `${mb(loaded)} of ${mb(total)} MB` : `${mb(loaded)} MB`;
}
