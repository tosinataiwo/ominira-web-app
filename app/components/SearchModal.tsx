"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import NoResults from "@/app/components/shared/NoResults";
import Link from "next/link";
import { Search, X } from "lucide-react";
import type { BookDocument } from "@/lib/book/schema";
import { useMaterialsSearch } from "@/lib/materials/useMaterialsSearch";
import { buildBookIndex, searchBook, type SearchResult } from "@/lib/search/bookIndex";
import BookCover from "@/app/components/shared/BookCover";
import { resolveBookThumbnailSrc } from "@/lib/materials/image";

function highlight(text: string, q: string) {
  if (!q) return text;
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let idx = lowerText.indexOf(lowerQ, cursor);
  if (idx === -1) return text;
  while (idx !== -1) {
    parts.push(text.slice(cursor, idx));
    parts.push(
      <mark
        key={idx}
        style={{ background: "var(--reader-highlight)" }}
        className="text-inherit rounded-[2px]"
      >
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    cursor = idx + q.length;
    idx = lowerText.indexOf(lowerQ, cursor);
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

type Props = {
  /** Omitted on the home page, which has no single book in scope — see the
   * library-wide branch below. Every in-reader call site (Reader.tsx) still
   * passes this, keeping that book-scoped passage search unchanged. */
  book?: BookDocument;
  onNavigate?: (sectionId: string, passageId: string) => void;
  onClose?: () => void;
};

/** Same rounded-row footprint as a real result (SearchModal's own two
 * result-row shapes below) so the list doesn't jump once results swap in —
 * shown while `isSearching` is true, i.e. only in the library-wide
 * (backend-search) mode. Book-scoped search is a synchronous in-memory
 * MiniSearch query (see searchBook), so it never has a loading state to
 * skeleton. */
function ResultRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-[var(--reader-border)] animate-pulse">
      <div className="h-14 w-11 flex-none rounded-sm bg-[var(--reader-surface-hover)]" />
      <div className="min-w-0 flex-1">
        <div className="mb-2 h-3 w-2/3 rounded-full bg-[var(--reader-surface-hover)]" />
        <div className="h-2.5 w-2/5 rounded-full bg-[var(--reader-surface-hover)]" />
      </div>
    </div>
  );
}

export default function SearchModal({ book, onNavigate, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Book-scoped passage search (in-reader only) vs. library-wide book
  // search (home page + library page) — mutually exclusive, gated on
  // whether a `book` was actually passed in. buildBookIndex/searchBook
  // below are no-ops (never called) whenever `book` is undefined. Neither
  // branch splits into tabs (chapter/notes/discourse) any more — one
  // unified, relevance-ordered result list either way: MiniSearch's own
  // `.search()` already returns book results ranked highest-scoring first
  // (searchBook does no re-sorting of its own), and the library-wide branch
  // is ranked server-side (lib/materials/list.ts's relevanceScore).
  const index = useMemo(() => (book ? buildBookIndex(book) : null), [book]);
  const results: SearchResult[] = useMemo(() => (index ? searchBook(index, query) : []), [index, query]);
  const { results: libraryResults, isSearching } = useMaterialsSearch(book ? "" : query, { limit: 20 });

  return (
    <div
      className={`w-full h-full box-border bg-black/45 flex justify-center ${
        isMobile ? "items-stretch p-0" : "items-start py-16 px-6"
      }`}
    >
      <div
        className={`w-full bg-[var(--reader-surface)] shadow-lg flex flex-col box-border overflow-hidden ${
          isMobile ? "h-full rounded-none" : "max-w-[640px] h-[640px] rounded-lg"
        }`}
      >
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[var(--reader-border)] flex-none">
          <Search size={18} className="text-[var(--reader-text-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={book ? "Search document..." : "Search the library"}
            className="flex-1 border-none outline-none text-[13px] font-semibold text-[var(--reader-text)] bg-transparent"
          />
          {query && (
            <span
              onClick={() => setQuery("")}
              className="cursor-pointer text-[var(--reader-text-muted)]"
            >
              <X size={16} />
            </span>
          )}
          <span
            onClick={onClose}
            className="cursor-pointer text-sm font-semibold text-[var(--reader-text-muted)] whitespace-nowrap"
          >
            {isMobile ? "Cancel" : "Close"}
          </span>
        </div>

        <div className="om-scroll flex-1 overflow-y-auto px-5 py-4">
          {book ? (
            <>
              {results.map((r) => (
                <div
                  key={r.passageId}
                  // Navigates without closing the modal — a reader jumping
                  // between several passages shouldn't have to reopen
                  // search after every click; Close/Cancel (or the X) is
                  // still right there for when they're actually done.
                  onClick={() => onNavigate?.(r.sectionId, r.passageId)}
                  className="py-3 border-b border-[var(--reader-border)] cursor-pointer"
                >
                  {/* Stacked on mobile (each of title/author/section gets
                      its own line — there's rarely room for all three side
                      by side on a phone-width modal), but from md up they
                      sit inline and wrap only if they actually don't fit —
                      not a fixed vertical stack regardless of width. */}
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-serif text-[13px] font-semibold text-[var(--reader-text)]">
                      {book.metadata.title}
                    </span>
                    <span className="text-xs text-[var(--reader-text-muted)]">{book.metadata.author}</span>
                    <span className="text-xs font-medium text-[var(--reader-text-muted)]">
                      {r.sectionTitle}
                    </span>
                  </div>
                  <p className="mt-1.5 font-serif type-4 text-[14px] text-[var(--reader-text)]">
                    {highlight(r.text, query)}
                  </p>
                </div>
              ))}
              {query.trim() && results.length === 0 && (
                <NoResults className="text-center py-10" message={`No results for "${query}".`} />
              )}
            </>
          ) : (
            <>
              {isSearching
                ? Array.from({ length: 5 }).map((_, i) => <ResultRowSkeleton key={i} />)
                : libraryResults.map((material) => (
                    <Link
                      key={material.id}
                      href={`/library/${material.slug}`}
                      // Left open on click, same as the book-scoped branch
                      // above — a reader browsing several results in a row
                      // shouldn't lose the search each time.
                      className="flex items-center gap-3 py-3 border-b border-[var(--reader-border)] no-underline"
                    >
                      <BookCover materialType={material.materialType} src={resolveBookThumbnailSrc(material)} alt={material.title} className="h-14 w-11 flex-none rounded-sm border border-[var(--reader-border)]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-[var(--reader-text)]">
                          {highlight(material.title, query)}
                        </div>
                        <div className="truncate text-xs font-medium text-[var(--reader-text-muted)]">
                          {highlight(material.author, query)}
                        </div>
                      </div>
                    </Link>
                  ))}
              {!isSearching && query.trim() && libraryResults.length === 0 && (
                <div className="py-10 text-center">
                  <NoResults className="m-0" message={`No results for "${query}"`} />
                  {/* <p className="mt-2 mb-4 text-sm text-[var(--reader-text-muted)]">
                    Can&rsquo;t find this book? Suggest it for the library.
                  </p>
                  <a
                    href="https://t.me/africanyeast"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-sand-25 no-underline transition-opacity hover:opacity-90"
                  >
                    Suggest
                  </a> */}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
