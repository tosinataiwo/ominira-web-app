"use client";

import Link from "next/link";
import { useFeaturedBooks } from "@/lib/general/useFeaturedBooks";
import BookCover from "@/app/components/shared/BookCover";
import { resolveBookCoverSrc } from "@/lib/materials/image";

/**
 * "Featured this week" — the home page's former TopBooksRail slot, now a
 * hand-curated set of books (config/featured.json, resolved via `GET
 * /api/general/featured-books`) instead of a random catalog sample. Same
 * self-fetching shape and heading treatment as ContinueReadingRail/the old
 * TopBooksRail (`h2`, standard reader-text black, `mb-15` section) for
 * consistency with the rest of this page. Renders nothing at all once
 * loaded empty — same as those two — rather than an empty section.
 */
export default function FeaturedThisWeek() {
  const { data: books, isLoading } = useFeaturedBooks();

  if (!isLoading && (!books || books.length === 0)) return null;

  return (
    <section className="mb-15">
      <div className="mb-5">
        <h2 className="font-serif type-3 text-balance m-0 text-[var(--reader-text)]">Featured books</h2>
      </div>

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-[225px] w-[150px] flex-none animate-pulse rounded-sm border border-[var(--reader-border)] bg-[var(--reader-surface-hover)]" />
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {books!.map(({ material }) => (
            <Link key={material.id} href={`/library/${material.slug}`} className="group block w-[150px] flex-none no-underline">
              <div className="h-[225px] w-[150px] overflow-hidden rounded-sm border border-[var(--reader-border)] shadow-md">
                <BookCover materialType={material.materialType} src={resolveBookCoverSrc(material)} alt={material.title} className="h-full w-full" />
              </div>
              <div className="mt-2.5 text-[12px] font-bold leading-tight text-[var(--reader-text)] group-hover:text-brand-500">
                {material.title}
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-[var(--reader-text-muted)]">{material.author}</div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
