"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { BookOpen, Hash, Megaphone, MessageCircle } from "lucide-react";
import SearchableAppPage from "@/app/components/shell/SearchableAppPage";
import ReaderAvatar from "@/app/components/shared/ReaderAvatar";
import Loader from "@/app/components/Loader";
import NoResults from "@/app/components/shared/NoResults";
import LoadMoreButton from "@/app/components/shared/LoadMoreButton";
import { useIsAuthenticated } from "@/lib/auth/useIsAuthenticated";
import { useNotifications, type NotificationItem } from "@/lib/notifications/useNotifications";
import { useMarkNotificationsRead } from "@/lib/notifications/useMarkNotificationsRead";
import { apiFetch } from "@/lib/api/client";
import { comradeName } from "@/lib/reader/authorDisplay";
import { formatTimeAgo } from "@/lib/reader/timeAgo";
import { notificationSnippet } from "@/lib/notifications/snippet";
import type { NotificationKind } from "@/lib/notifications/types";

/** The raised fist, matching the reaction button's own ✊🏾 — lucide has no
 * fist, and the badge needs a stroke icon at badge size, not an emoji. */
function FistIcon({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 12V7a2 2 0 0 1 4 0" />
      <path d="M12 12V6a2 2 0 0 1 4 0v6" />
      <path d="M16 12V7a2 2 0 0 1 4 0v7a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L3.6 14a1.7 1.7 0 0 1 2.5-2.2L8 13.5" />
    </svg>
  );
}

// One color + icon per kind, so the notification type is scannable from the
// avatar corner without reading the line (Notifications design). Colors come
// from the same accent scale as generated avatars — deliberately not all
// brand orange, which would make every badge look identical.
const KIND_STYLE: Record<NotificationKind, { color: string; icon: (props: { size?: number }) => ReactNode }> = {
  reaction: { color: "var(--color-brand-500)", icon: FistIcon },
  material_reaction: { color: "var(--color-oxblood-500)", icon: BookOpen },
  reply: { color: "var(--color-forest-500)", icon: MessageCircle },
  digest: { color: "var(--color-olive-500)", icon: Hash },
  broadcast: { color: "var(--color-olive-500)", icon: Megaphone },
};

// notify.ts prefixes push titles with an emoji (✊🏾/💬) because a push has no
// room for a badge. On this page the corner badge already says the type, so
// the emoji is stripped rather than shown twice.
const LEADING_EMOJI = /^\p{Extended_Pictographic}[\p{Emoji_Modifier}‍\p{Extended_Pictographic}️]*\s*/u;

// Every actor-driven title reads "<Comrade Name> <did something>", so the
// name is split off the front and bolded, leaving the rest at normal weight
// — the mockup's one-bold-span line, not a wall of semibold. Falls back to
// parsing the title when actor_reader_id is null (every row written before
// that column existed), so old notifications read the same as new ones.
const TITLE_ACTOR = /^(Comrade\s+\S+)(\s+.*)$/;

// Longer than the push body's own cut (140) — a row has two clamped lines
// to work with, not a lock screen's one.
const ROW_SNIPPET_CHARS = 200;

// notify.ts used to write "Tap to view in The Jakarta Method" as the body —
// an instruction that made sense on a lock screen and none at all on a row
// you're already looking at. It now writes the note's own words instead, so
// this only exists to drop that copy from rows written before the change.
const LEGACY_PUSH_BODY = /^Tap to view in\s+/;

function NotificationRow({ item, isUnread }: { item: NotificationItem; isUnread: boolean }) {
  const { color, icon: KindIcon } = KIND_STYLE[item.kind] ?? KIND_STYLE.broadcast;
  const title = item.title.replace(LEADING_EMOJI, "");

  const parsed = TITLE_ACTOR.exec(title);
  const actor = item.actorPseudonym ? comradeName(item.actorPseudonym) : (parsed?.[1] ?? null);
  const action = actor ? (title.startsWith(actor) ? title.slice(actor.length) : (parsed?.[2] ?? null)) : null;

  // A book appreciation's body is the bare book title — it trails the
  // sentence rather than sitting under it as a quote, since it isn't one.
  const context = item.kind === "material_reaction" ? item.body : null;

  // The quoted line: the note's own words. `snippet` holds the full text
  // (the push body is cut short for a lock screen), so the row gets its own
  // slightly longer cut, then line-clamps whatever still overflows. Falls
  // back to the body for a broadcast's actual message — but never for the
  // legacy "tap to view" copy, which says nothing worth a line.
  const snippet = context ? null : notificationSnippet(item.snippet, ROW_SNIPPET_CHARS);
  const detail = snippet
    ? `“${snippet}”`
    : context || LEGACY_PUSH_BODY.test(item.body)
      ? null
      : item.body;

  return (
    <Link
      href={item.url}
      className={`relative flex items-start gap-3.5 py-4 no-underline transition-colors hover:bg-[var(--reader-surface-hover)] ${
        isUnread ? "bg-[color-mix(in_srgb,var(--reader-accent)_7%,transparent)]" : ""
      }`}
    >
      {isUnread && (
        <span
          aria-hidden
          className="absolute top-1/2 left-2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[var(--reader-accent)]"
        />
      )}

      <span className="relative flex-none">
        {actor ? (
          <>
            <ReaderAvatar pseudonym={actor} avatar={item.actorAvatar} size={45} />
            {/* The corner badge exists to name the type on top of a *face*.
                On an actorless row the tile below already is that icon, so
                badging it would just draw the same glyph twice. */}
            <span
              aria-hidden
              style={{ background: color }}
              className="absolute -right-1 -bottom-1 flex h-[20px] w-[20px] items-center justify-center rounded-full text-white ring-[2.5px] ring-[var(--reader-bg)]"
            >
              <KindIcon size={11} />
            </span>
          </>
        ) : (
          <span
            aria-hidden
            style={{ background: color }}
            className="flex h-11 w-11 items-center justify-center rounded-full text-white"
          >
            <KindIcon size={19} />
          </span>
        )}
      </span>

      {/* Three distinct sizes rather than one: the sentence carries the row,
          so it sits just under body size and reads at a glance; the quote
          beneath it is the same serif the note itself is set in elsewhere
          in the app, italic and muted so it recedes without shrinking; only
          the timestamp stays genuinely small. Scaling all three together
          was what left this page either too tiny to read or, once bumped,
          shouty — the fix is hierarchy, not one larger font size. */}
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 pt-px">
        <span className="text-[13px] leading-[1.45] text-[var(--reader-text)]">
          {actor && action ? (
            <>
              <span className="font-bold">{actor}</span>
              <span className="font-medium">{action}</span>
              {context && (
                <>
                  {item.kind === "material_reaction" ? " · " : " in "}
                  <span className="font-semibold text-[var(--reader-text-muted)]">{context}</span>
                </>
              )}
            </>
          ) : (
            title
          )}
        </span>
        {detail && (
          <span className="line-clamp-2 font-serif text-[14px] leading-[1.65] text-[var(--reader-text-muted)]">
            {detail}
          </span>
        )}
        <span className="text-[11px] font-semibold tracking-wide text-[var(--reader-text-subtle)]">
          {formatTimeAgo(new Date(item.createdAt).getTime())}
        </span>
      </span>
    </Link>
  );
}

export default function NotificationsView() {
  const isAuthenticated = useIsAuthenticated();
  const { data, isLoading, isError } = useNotifications();
  const markRead = useMarkNotificationsRead();

  // Only the pages fetched by "Load more" live in local state — the first
  // page comes straight from useNotifications()'s query data, concatenated
  // below, so there's no effect syncing query data into local state (and no
  // risk of the two drifting after a cache invalidation like markRead's).
  const [extraItems, setExtraItems] = useState<NotificationItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const items = useMemo(() => [...(data?.items ?? []), ...extraItems], [data?.items, extraItems]);
  const nextCursor = cursor === undefined ? (data?.nextCursor ?? null) : cursor;

  // Opening this page is the "seen it" signal — clears the bell badge the
  // same way opening an inbox does, no per-item tap required.
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    if (isAuthenticated && data && data.unreadCount > 0) markReadMutate(undefined);
  }, [isAuthenticated, data, markReadMutate]);

  // …which would also wipe every unread tint the moment that refetch lands.
  // So the ids that arrived unread are remembered for the visit: the bell
  // badge clears immediately, but the rows stay marked until the reader
  // navigates away. Chronological order is the only grouping here — a
  // New/Earlier split on top of an inbox that marks itself read on open
  // draws a heading around a distinction that's already gone.
  //
  // A ref rather than state: this only records what the render is already
  // showing, so state would mean a second render per page to reach identical
  // markup. Adding ids is idempotent, which is why the react-hooks/refs
  // warning is safe to silence here specifically.
  /* eslint-disable react-hooks/refs */
  const unreadIdsRef = useRef<Set<string>>(new Set());
  for (const item of items) if (!item.read) unreadIdsRef.current.add(item.id);
  // Read out once, into a plain value — nothing below this line touches the
  // ref again, so the rest of the render (and the JSX) stays ref-free.
  const rows = items.map((item) => ({
    item,
    isUnread: unreadIdsRef.current.has(item.id),
  }));
  /* eslint-enable react-hooks/refs */

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<{
        items: NotificationItem[];
        nextCursor: string | null;
      }>(`/notifications?cursor=${encodeURIComponent(nextCursor)}`);
      setExtraItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <SearchableAppPage>
      {/* Same heading treatment as Home's "Community posts", and the same
          reading column the feed uses — a notification line is the same kind
          of text, and full page width left it stranded. */}
      <h1 className="font-serif type-3 text-balance mt-1 mb-6 text-[var(--reader-text)]">Notifications</h1>

      <div className="">
        {!isAuthenticated ? (
          <p className="text-sm text-[var(--reader-text-muted)]">Log in to see your notifications.</p>
        ) : isLoading ? (
          <div className="relative min-h-[240px]">
            <Loader confined />
          </div>
        ) : isError ? (
          <NoResults message="Couldn't load your notifications. Try again in a moment." />
        ) : items.length === 0 ? (
          <NoResults message="No notifications yet." />
        ) : (
          <>
            <div className="divide-y divide-[var(--reader-border)] border-y border-[var(--reader-border)]">
              {rows.map(({ item, isUnread }) => (
                <NotificationRow key={item.id} item={item} isUnread={isUnread} />
              ))}
            </div>

            {nextCursor && <LoadMoreButton onClick={loadMore} isLoading={loadingMore} />}
          </>
        )}
      </div>
    </SearchableAppPage>
  );
}
