"use client";

import { useState } from "react";
import SearchableAppPage from "@/app/components/shell/SearchableAppPage";
import BookListRow from "@/app/components/shell/BookListRow";
import NoteCard from "@/app/components/reader/notes/NoteCard";
import NoResults from "@/app/components/shared/NoResults";
import ShelfAuthPrompt from "@/app/components/books/ShelfAuthPrompt";
import UnderlineTabs from "@/app/components/UnderlineTabs";
import { communityFeedItemHref } from "@/lib/community/useCommunityFeed";
import { resolveBookThumbnailSrc } from "@/lib/materials/image";
import { useIsAuthenticated } from "@/lib/auth/useIsAuthenticated";
import { useContinueReading, useRemoveFromShelf, useRestoreToShelf, type ContinueReadingItem } from "@/lib/auth/useContinueReading";
import { useSavedMaterials, useSavedNotes, useToggleMaterialBookmark } from "@/lib/bookmarks/useBookmarks";

type Tab = "reading" | "saved" | "finished";

const TABS: { value: Tab; label: string }[] = [
  { value: "reading", label: "Reading" },
  { value: "saved", label: "Bookmarks" },
  { value: "finished", label: "Finished" },
];

// Same 1-col mobile / 2-col desktop grid the real rows render into (not
// space-y-3's single column) — otherwise the skeleton collapses to one
// column on desktop and the layout visibly jumps to two the moment real
// rows swap in.
function BookGridSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-1 gap-x-10 shell:grid-cols-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="my-2 h-36 animate-pulse rounded-sm bg-[var(--reader-surface-hover)]" />
      ))}
    </div>
  );
}

/** Same list-row card (and 1-col mobile / 2-col desktop layout) as the
 * Library catalogue, shared by all three tabs. */
function BookGrid({
  items,
}: {
  items: {
    material: React.ComponentProps<typeof BookListRow>["material"];
    resumeTarget?: React.ComponentProps<typeof BookListRow>["resumeTarget"];
    onRemove?: () => void;
    /** When set, this slot renders the undo strip instead of the row — see
     * RemovedRow and ShelfView's `removed` state. */
    removed?: { onUndo: () => void };
  }[];
}) {
  return (
    <div className="grid grid-cols-1 shell:grid-cols-2 shell:gap-x-10">
      {items.map(({ material, resumeTarget, onRemove, removed }) =>
        removed ? (
          <RemovedRow key={material.id} title={material.title} onUndo={removed.onUndo} />
        ) : (
          <BookListRow key={material.id} material={material} resumeTarget={resumeTarget} onRemove={onRemove} />
        )
      )}
    </div>
  );
}

/**
 * What a just-removed row collapses into — standing in the removed row's own
 * grid slot, so the list neither reflows nor loses the reader's place.
 *
 * This is the undo, instead of a toast: the app has no toast system, and
 * putting the affordance where the thing was is more legible than a
 * detached corner notification anyway — especially for a reader clearing
 * several books in a row, who then gets one undo per removal rather than a
 * single toast overwriting itself.
 *
 * It's a strip, not the full row: the book is gone, and re-rendering the
 * cover and progress would read as "nothing happened". `border-b` and the
 * row's own vertical rhythm are kept so the list doesn't jump.
 */
function RemovedRow({ title, onUndo }: { title: string; onUndo: () => void }) {
  return (
    <div
      // aria-live, so a screen-reader user who just pressed the X hears that
      // it worked — the X itself vanished along with the row, so nothing
      // else would say so.
      aria-live="polite"
      className="flex min-w-0 items-center gap-3 border-b border-[var(--reader-border)] py-4 text-[12px]"
    >
      <span className="min-w-0 flex-1 truncate text-[var(--reader-text-muted)]">
        Removed <span className="font-semibold text-[var(--reader-text)]">{title}</span>
      </span>
      <button
        type="button"
        onClick={onUndo}
        className="flex-none cursor-pointer border-none bg-transparent p-0 text-[12px] font-bold text-brand-500 underline hover:no-underline"
      >
        Undo
      </button>
    </div>
  );
}

/**
 * The reader's own shelf — everything on this page is *theirs*, in three
 * tabs: what they're partway through, what they've saved for later, and
 * what they've finished.
 *
 * One page with tabs rather than a second "Bookmarks" nav destination
 * beside this one. A Saved tab is the same personal shelf as a Reading
 * tab, just sorted by a different act (saving vs. starting), and NAV_ITEMS
 * has already been through the argument against two entry points for one
 * idea once — see its note on Account moving out of the nav. Tabs also
 * finally give `reader_activities.finished_at` (live since migrations/
 * 20261002, written by PUT /api/auth/me/finished) a surface to live on;
 * before this, a finished book just sat in the middle of the in-progress
 * list wearing a "Finished" line.
 *
 * Called Shelf, not Reading (its old name, /reading, still redirecting via
 * next.config.ts) — reading is one of the three tabs now, and a page can't
 * share a name with one of its own drawers. Not "History" either: a
 * bookmark is a deliberate act of setting something aside, a reading
 * position is passive residue, and one past-tense word over both would
 * make the Saved tab read like a log.
 *
 * The active tab is plain local state, deliberately not a `?tab=` URL
 * param like Library's `?q=` or Home's `?topic=`. Those name something
 * public and worth linking to (a category, a topic); which drawer of your
 * own shelf you had open is neither shareable nor worth a navigation per
 * switch.
 */
export default function ShelfView() {
  const isAuthenticated = useIsAuthenticated();
  const [tab, setTab] = useState<Tab>("reading");

  const { data: activities, isLoading: activitiesLoading } = useContinueReading();
  const { data: savedBooks, isLoading: savedBooksLoading } = useSavedMaterials();
  const { data: savedNotes, isLoading: savedNotesLoading } = useSavedNotes();
  const toggleBookmark = useToggleMaterialBookmark();

  // finishedAt is the reader's own explicit mark (DocumentEndPanel), never
  // a threshold on progress — so this split is exact, not a heuristic.
  //
  // Both keep the order they arrive in, which is already last-read-first:
  // GET /continue-reading sorts by reader_activities.updated_at desc in the
  // DB (listReaderActivities, served by reader_activities_reader_updated_
  // idx), and that column is touched by every position save. Re-sorting
  // here would only be a second, driftable copy of that rule.
  const inProgress = (activities ?? []).filter((item) => !item.finishedAt);
  const finished = (activities ?? []).filter((item) => item.finishedAt);

  // Which rows this reader has removed but could still undo, as a set of
  // materialIds. Local, not a cache mutation: the removed item has to stay in
  // `activities` for its undo strip to have a title to show and a record to
  // restore from, so removal is expressed by hiding the row here rather than
  // by dropping it from the query (see useRemoveFromShelf's own note). The
  // set clears itself naturally — on the next refetch the server no longer
  // returns those rows, and an undone row is deleted from the set, so it
  // can't outlive its own data either way.
  //
  // Not a timer-expired undo: nothing forces this reader to decide within
  // five seconds, and a strip that silently becomes a permanent deletion
  // while they're reading the tab is worse than one that waits.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const removeFromShelf = useRemoveFromShelf();
  const restoreToShelf = useRestoreToShelf();

  function remove(item: ContinueReadingItem) {
    setRemovedIds((ids) => new Set(ids).add(item.material.id));
    removeFromShelf.mutate(item, {
      // A failed delete has to put the row back, or the reader is left
      // looking at an undo strip for a book that's still on their shelf.
      onError: () =>
        setRemovedIds((ids) => {
          const next = new Set(ids);
          next.delete(item.material.id);
          return next;
        }),
    });
  }

  function undo(item: ContinueReadingItem) {
    setRemovedIds((ids) => {
      const next = new Set(ids);
      next.delete(item.material.id);
      return next;
    });
    restoreToShelf.mutate(item, {
      onError: () => setRemovedIds((ids) => new Set(ids).add(item.material.id)),
    });
  }

  /** The three per-row props every activity-backed tab wires identically. */
  const activityRow = (item: ContinueReadingItem) => ({
    material: item.material,
    // resumeTarget is what sends each row straight into the reader at this
    // reader's own real section/passage instead of the book-detail page —
    // every item here already carries its own reader_activities locator
    // straight from GET /continue-reading, no client-store read needed.
    resumeTarget: item,
    onRemove: () => remove(item),
    ...(removedIds.has(item.material.id) ? { removed: { onUndo: () => undo(item) } } : {}),
  });

  const header = (
    <div className="mt-1 mb-7">
      <h1 className="font-serif type-3 text-balance m-0 text-[var(--reader-text)]">Shelf</h1>
    </div>
  );

  // Signed-out readers land here with nothing to show in any of the three
  // tabs — all three are "yours" by definition — so the gate replaces the
  // whole page rather than each tab's body. Rather than the generic "join
  // the movement" pitch the home feed uses, ShelfAuthPrompt gates a
  // preview of this page's own layout (see its header comment), so the
  // nudge is specific to what's actually missing.
  if (!isAuthenticated) {
    return (
      <SearchableAppPage>
        {header}
        <ShelfAuthPrompt />
      </SearchableAppPage>
    );
  }

  return (
    <SearchableAppPage>
      {header}

      {/* Underline tabs, not CategoryPills: these are three views of one
          page, not a filter over one list, and pills are already spoken
          for elsewhere in the app as "narrow this list down". */}
      <div className="mb-0">
        <UnderlineTabs options={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === "reading" &&
        (activitiesLoading ? (
          <BookGridSkeleton />
        ) : inProgress.length === 0 ? (
            <NoResults className="mt-5" message="Start a book from the library and it will appear here." />
        ) : (
          <BookGrid items={inProgress.map(activityRow)} />
        ))}

      {tab === "finished" &&
        (activitiesLoading ? (
          <BookGridSkeleton rows={4} />
        ) : finished.length === 0 ? (
            <NoResults className="mt-5" message="Books you mark finished will collect here." />
        ) : (
          // Still resumable, same as an in-progress row: the saved locator
          // reopens exactly where they stopped, which is what makes a
          // finished book re-readable rather than archived. BookListRow's
          // own ProgressLine renders these as "Finished" rather than a
          // percentage.
          <BookGrid items={finished.map(activityRow)} />
        ))}

      {tab === "saved" && (
        <>
          {savedBooksLoading ? (
            <BookGridSkeleton rows={4} />
          ) : savedBooks?.length ? (
            // No resumeTarget: a saved book is one the reader flagged to
            // come back to, very often without having opened it yet, so the
            // detail page (blurb, outline, CTAs) is the right landing spot —
            // the same distinction the Library catalogue makes.
            <BookGrid items={savedBooks.map((material) => ({ material, onRemove: () => toggleBookmark.mutate(material.id) }))} />
          ) : null}

          {/* Posts and books share the tab rather than splitting into a
              fourth: both are the same act (save this, come back to it),
              and separating them would mean two half-empty lists for most
              readers. The heading only appears when there's actually a
              mixed shelf to disambiguate. */}
          {savedNotes?.length ? (
            <div className="mx-auto mt-10 max-w-[640px]">
              {savedBooks?.length ? (
                <h2 className="font-serif type-3 text-balance m-0 mb-1 text-[var(--reader-text)]">Saved posts</h2>
              ) : null}
              <div className="flex flex-col">
                {savedNotes.map((item) => (
                  <NoteCard
                    key={item.note.id}
                    materialId={item.material?.id ?? null}
                    note={item.note}
                    replies={item.replies}
                    excerpt={item.excerpt}
                    {...(item.material
                      ? {
                          bookContext: {
                            href: communityFeedItemHref(item) ?? "",
                            title: item.material.title,
                            author: item.material.author,
                            section: item.label ?? undefined,
                            coverUrl: resolveBookThumbnailSrc(item.material),
                            materialType: item.material.materialType,
                          },
                        }
                      : {})}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {!savedBooksLoading && !savedNotesLoading && !savedBooks?.length && !savedNotes?.length && (
             <NoResults className="mt-5" message="Nothing saved yet — tap the bookmark on any book or post to keep it here." />
          )}
        </>
      )}
    </SearchableAppPage>
  );
}
