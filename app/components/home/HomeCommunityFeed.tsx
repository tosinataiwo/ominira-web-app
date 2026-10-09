"use client";

import { useState } from "react";
import NoResults from "@/app/components/shared/NoResults";
import { useSearchParams } from "next/navigation";
import SearchableAppPage from "@/app/components/shell/SearchableAppPage";
import { communityFeedItemHref, useCommunityFeed, type CommunityFeedSort } from "@/lib/community/useCommunityFeed";
import { useTopics } from "@/lib/community/useTopics";
import { resolveBookThumbnailSrc } from "@/lib/materials/image";
import FeaturedThisWeek from "@/app/components/shell/FeaturedThisWeek";
import { useIsAuthenticated } from "@/lib/auth/useIsAuthenticated";
import HomeComposer from "./HomeComposer";
import CategoryPills from "@/app/components/shell/CategoryPills";
import HomeSortToggle from "./HomeSortToggle";
import NoteCard from "@/app/components/reader/notes/NoteCard";
import HomeAuthBanner from "./HomeAuthBanner";
import HomeInstallBanner from "./HomeInstallBanner";
import HomePushPrompt from "./HomePushPrompt";

const SHOW_HOME_COMPOSER = false;

/** Stand-in for a NoteCard while `GET /api/community/notes` is still in
 * flight — same flush flat-row footprint as the real card, at every width,
 * so the feed's layout doesn't jump once real cards swap in, and so this
 * reads as "loading," not as an empty state. */
function NoteCardSkeleton() {
  return (
    <div className="animate-pulse border-b border-[var(--reader-border)] py-4">
      <div className="mb-3 h-3 w-2/3 rounded-full bg-[var(--reader-surface-hover)]" />
      <div className="mb-2 h-3 w-full rounded-full bg-[var(--reader-surface-hover)]" />
      <div className="mb-4 h-3 w-4/5 rounded-full bg-[var(--reader-surface-hover)]" />
      <div className="h-2.5 w-1/3 rounded-full bg-[var(--reader-surface-hover)]" />
    </div>
  );
}

/** The home page's real content — a "continue reading" shelf, then the
 * global community feed (`GET /api/community/notes`), newest or top-
 * reacted first. Same page-composition shape as LibraryView (AppHeader,
 * then a page heading + a filter control, then the content). */
export default function HomeCommunityFeed() {
  const isAuthenticated = useIsAuthenticated();
  const [sort, setSort] = useState<CommunityFeedSort>("recent");
  const { data: topics } = useTopics();
  // The active filter lives in the URL (`?topic=<slug>`), same as Library's
  // own `?q=<slug>` — shareable/bookmarkable, and survives a refresh or the
  // back button, unlike plain component state. Resolved against the fetched
  // topics list (slug -> id) rather than trusting the id straight off the
  // URL, same reasoning as Library's resolveCategoryFromSlug: an unknown or
  // stale slug just falls back to "All" instead of erroring.
  const topicSlug = useSearchParams().get("topic");
  const topicId = topics?.find((t) => t.slug === topicSlug)?.id ?? null;
  const { data, isLoading } = useCommunityFeed(sort, topicId);
  const items = data?.items ?? [];

  return (
    <SearchableAppPage>

      <HomeInstallBanner />
      <HomeAuthBanner />
      <HomePushPrompt />

      <FeaturedThisWeek />

      <div className="mt-1 mb-7">
        <h1 className="font-serif type-3 text-balance m-0 text-[var(--reader-text)]">Community notes</h1>
      </div>

      <div className="mb-10">
        <CategoryPills
          items={(topics ?? []).map((topic) => ({ key: topic.slug, label: topic.name }))}
          allKey="all"
          selected={topicSlug ?? "all"}
          hrefFor={(key) => (key === "all" ? "/home" : `/home?topic=${key}`)}
        />
      </div>

      <div className="mx-auto max-w-[640px]">
        {/* Temporarily hidden — flip SHOW_HOME_COMPOSER to restore. */}
        {SHOW_HOME_COMPOSER && isAuthenticated && (
          <div className="mb-8">
            <HomeComposer defaultTopicId={topicId} />
          </div>
        )}

        <div className="mb-0">
          <HomeSortToggle mode={sort} onChange={setSort} />
        </div>

        <div className="mt-0">
          {isLoading ? (
            <div className="flex flex-col">
              {Array.from({ length: 4 }).map((_, i) => (
                <NoteCardSkeleton key={i} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <NoResults
              className="mt-5 font-bold"
              message={
                topicId
                  ? "Nothing here yet — be the first to share notes on this topic."
                  : "No one's here yet in this view — try widening your filters, or start the thread yourself."
              }
            />
          ) : (
            // One column of flat rows, each separated by its own bottom
            // border, at every width — no boxed/masonry treatment on desktop
            // (see NoteCard's own doc comment for why: CSS multi-column forced
            // a full-feed reflow whenever any one card's height changed, e.g.
            // its inline reply composer opening).
            <div className="flex flex-col">
              {items.map((item) => (
                <NoteCard
                  key={item.note.id}
                  materialId={item.material?.id ?? null}
                  note={item.note}
                  replies={item.replies}
                  excerpt={item.excerpt}
                  // No book context at all for a book-less discussion post
                  // — there's no book to preview or link into.
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
          )}
        </div>
      </div>
    </SearchableAppPage>
  );
}
