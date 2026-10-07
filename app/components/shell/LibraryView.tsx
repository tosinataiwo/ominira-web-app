"use client";

import { useEffect, useState } from "react";
import NoResults from "@/app/components/shared/NoResults";
import LoadMoreButton from "@/app/components/shared/LoadMoreButton";
import { Plus } from "lucide-react";
import CategoryPills from "./CategoryPills";
import BookListRow from "./BookListRow";
import Loader from "@/app/components/Loader";
import AddBookModal from "./AddBookModal";
import ContributeBookRow from "./ContributeBookRow";
import SearchableAppPage from "./SearchableAppPage";
import type { MaterialSummary } from "@/lib/api/types";
import type { CategoryContributionStats } from "@/lib/materials/list";
import { useContinueReading } from "@/lib/auth/useContinueReading";
import { useProfile } from "@/lib/auth/useProfile";
import { useIsAuthenticated } from "@/lib/auth/useIsAuthenticated";
import { apiFetch } from "@/lib/api/client";
import { slugifyCategory } from "@/lib/categories/slug";

const ALL_CATEGORY = "All";

const PAGE_SIZE = 50;

type Props = {
  materials: MaterialSummary[];
  /** `nextCursor` from the server's own first page (`app/(app)/library/
   * page.tsx`, `sort: "alphabetical"`, 50 at a time, already filtered to
   * `category`) — null means that first page was already everything in
   * this category. */
  initialNextCursor: string | null;
  categories: string[];
  /** Resolved server-side from the URL's own `?q=<slug>` (see
   * resolveCategoryFromSlug in page.tsx) — "All" when there's no `q`, or it
   * doesn't match a known category. Switching category is a real
   * navigation now (CategoryPills renders `<Link>`s straight to `/library?
   * q=...`), so this only ever changes via a fresh mount of this component
   * — page.tsx keys it by category for exactly that reason — never via
   * local state here. */
  category: string;
  /** Server-computed once per page load (page.tsx) — library-contribution-
   * ux-spec.md Step 2's contribution stats, read by ContributeBookRow. Not
   * re-fetched on "Load more"; the count/contributor list is static
   * furniture for the whole category, not expected to shift mid-scroll. */
  contributionStats: CategoryContributionStats;
};

export default function LibraryView({ materials, initialNextCursor, categories, category, contributionStats }: Props) {
  const [items, setItems] = useState(materials);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // "My uploads" (reader-uploads-spec.md § 3) is a separate view, not a
  // filter over `items` above — it's `uploaded_by = me` regardless of
  // category/visibility/status, a different query shape entirely (see
  // GET /api/materials/mine's own doc comment).
  const isAuthenticated = useIsAuthenticated();
  const { data: profile } = useProfile();
  // Uploading is for admin-approved readers only (/admin/readers).
  const canUpload = isAuthenticated && profile?.canUpload === true;
  const [view, setView] = useState<"catalog" | "mine">("catalog");
  const [myUploads, setMyUploads] = useState<MaterialSummary[] | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  // GET /materials/mine returns every upload regardless of category (see its
  // own doc comment), so unlike the catalog's `category` this is filtered
  // client-side, in place, rather than a fresh fetch per pill.
  const [mineCategory, setMineCategory] = useState(ALL_CATEGORY);
  // Derived, not its own state — "mine" selected and nothing fetched yet is
  // exactly the loading condition, so there's nothing to keep in sync by hand.
  const loadingMine = view === "mine" && myUploads === null;
  const visibleUploads = myUploads?.filter((m) => mineCategory === ALL_CATEGORY || m.categories.includes(mineCategory));

  useEffect(() => {
    if (view !== "mine" || myUploads !== null || !profile) return;
    apiFetch<{ items: MaterialSummary[] }>("/materials/mine")
      .then((page) => setMyUploads(page.items))
      .catch(() => setMyUploads([]));
  }, [view, myUploads, profile]);

  function updateUpload(updated: Pick<MaterialSummary, "id" | "title" | "author" | "visibility" | "categories" | "coverSource">) {
    setMyUploads((existing) => existing?.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)) ?? existing);
    setItems((existing) => existing.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
  }

  function removeUpload(id: string) {
    setMyUploads((existing) => existing?.filter((m) => m.id !== id) ?? existing);
    setItems((existing) => existing.filter((m) => m.id !== id));
  }

  // Populates reading-position-store's local mirror (progress bars on every
  // card below read it) for a reader who lands straight on /library without
  // ever visiting /home first — see useContinueReading's own doc comment.
  useContinueReading();

  async function loadMore() {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const params = new URLSearchParams({ sort: "alphabetical", limit: String(PAGE_SIZE), cursor: nextCursor });
      if (category !== "All") params.set("category", category);
      const page = await apiFetch<{ items: MaterialSummary[]; nextCursor: string | null }>(
        `/materials?${params.toString()}`
      );
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <SearchableAppPage>

      {canUpload && addModalOpen && (
        <AddBookModal
          category={category}
          categories={categories}
          onClose={() => setAddModalOpen(false)}
          onUploaded={() => {
            setMyUploads(null);
            setView("mine");
          }}
        />
      )}

      {/* Claude Design "Contribute Book Card" project, direction 1a's own
          cat-head: a small "Library" eyebrow over the real page title, not
          the other way round — ContributeBookRow (the row below) is now the
          add-book entry point, so this header no longer needs its own
          "+ Add a book" button/box competing with it. */}
      <div className="mt-1 mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--reader-text-muted)]">
          Library
        </span>
        {isAuthenticated && (
          <button
            type="button"
            onClick={() => setView(view === "mine" ? "catalog" : "mine")}
            className="cursor-pointer bg-transparent text-[13px] font-bold text-[var(--reader-text-muted)] hover:underline"
          >
            {view === "mine" ? "← Back to main library" : "Personal library only →"}
          </button>
        )}
      </div>

      {view === "mine" ? (
        <>
          <div className="mb-7 flex items-baseline justify-between gap-3">
            <h1 className="m-0 font-serif text-[26px] font-bold text-[var(--reader-text)]">Personal</h1>
            {canUpload && (
              <button
                type="button"
                onClick={() => setAddModalOpen(true)}
                className="flex flex-none cursor-pointer items-center gap-1.5 bg-transparent text-[13px] font-bold text-brand-500"
              >
                <Plus size={15} strokeWidth={2.5} />
                Add a book
              </button>
            )}
          </div>

          {loadingMine ? (
            // Same spinner as the main library's own route-level loading.tsx
            // (Loader), confined to this section rather than the fixed
            // viewport-wide variant a route transition uses — one shared
            // loading look across the app instead of a one-off skeleton here.
            <div className="relative h-40">
              <Loader confined />
            </div>
          ) : !myUploads || myUploads.length === 0 ? (
            <NoResults message={canUpload ? `You haven't added any books yet — use "Add a book" above.` : "You haven't added any books yet."} />
          ) : (
            <>
              <div className="mb-8">
                <CategoryPills
                  items={categories.map((c) => ({ key: c, label: c }))}
                  allKey={ALL_CATEGORY}
                  selected={mineCategory}
                  hrefFor={() => "#"}
                  onSelect={setMineCategory}
                />
              </div>

              {visibleUploads && visibleUploads.length === 0 ? (
                <p className="text-sm font-semibold text-[var(--reader-text-muted)]">
                  No personal uploads tagged &quot;{mineCategory}&quot; yet.
                </p>
              ) : (
                <div className="grid grid-cols-1 shell:grid-cols-2 shell:gap-x-10">
                  {visibleUploads?.map((material) => (
                    <BookListRow
                      key={material.id}
                      material={material}
                      categories={categories}
                      currentReaderId={profile?.id}
                      onUpdated={updateUpload}
                      onDeleted={removeUpload}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <h1 className="m-0 font-serif text-[26px] font-bold text-[var(--reader-text)]">{category}</h1>
          <p className="mb-5 text-[13px] font-semibold text-[var(--reader-text-muted)]">
            {contributionStats.bookCount} {contributionStats.bookCount === 1 ? "book" : "books"}
          </p>

          <div className="mb-10">
            <CategoryPills
              items={categories.map((c) => ({ key: c, label: c }))}
              allKey={ALL_CATEGORY}
              selected={category}
              hrefFor={(key) => (key === ALL_CATEGORY ? "/library" : `/library?q=${slugifyCategory(key)}`)}
            />
          </div>

          {canUpload && (
            <ContributeBookRow category={category} stats={contributionStats} onClick={() => setAddModalOpen(true)} />
          )}

          <div className="grid grid-cols-1 shell:grid-cols-2 shell:gap-x-10">
            {items.map((material) => (
              <BookListRow
                key={material.id}
                material={material}
                categories={categories}
                currentReaderId={profile?.id}
                onUpdated={updateUpload}
                onDeleted={removeUpload}
              />
            ))}
          </div>

          {items.length === 0 && (
            <NoResults
              className="mt-4"
              message={category === "All" ? "No books ingested yet." : `No books tagged "${category}" yet.`}
            />
          )}

          {nextCursor && <LoadMoreButton onClick={loadMore} isLoading={isLoadingMore} />}
        </>
      )}
    </SearchableAppPage>
  );
}
