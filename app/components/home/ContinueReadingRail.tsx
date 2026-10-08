"use client";

import { useContinueReading } from "@/lib/auth/useContinueReading";
import ContinueReadingItemCard from "@/app/components/books/ContinueReadingItemCard";

/**
 * `GET /api/auth/me/continue-reading` — self-fetching now (Phase 6), rather
 * than taking a `books` prop derived from a full local library listing: the
 * endpoint already returns exactly the shelf (sorted, filtered to
 * in-progress, each entry pre-joined with its own MaterialSummary), so
 * there's no client-side filtering/progress computation left to do here.
 * Renders nothing at all for an unauthenticated visitor — the query itself
 * never fires (see useContinueReading) since there's no `readers` row yet
 * to read a shelf from.
 */
export default function ContinueReadingRail() {
  const { data: items, isLoading } = useContinueReading();

  // isLoading (not just "!items"): useContinueReading's own query only
  // fires when authenticated at all (see its doc comment), so a
  // signed-out visitor's query never enters a loading state and this
  // still renders nothing for them — only a real in-flight fetch shows
  // the skeleton below rather than the section just not existing yet.
  if (!isLoading && (!items || items.length === 0)) return null;

  return (
    <section className="mb-15">
      <div className="mb-5">
        <h2 className="font-serif type-3 text-balance m-0 text-[var(--reader-text)]">Continue reading</h2>
        {/* <p className="mt-1 mb-0 font-serif text-sm text-[var(--reader-text-muted)]">Right where you left off.</p> */}
      </div>
      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-[104px] w-60 flex-none animate-pulse rounded-sm border border-[var(--reader-border)] bg-[var(--reader-surface-hover)] md:w-70"
            />
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items!.map((item) => (
            <ContinueReadingItemCard key={item.material.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
