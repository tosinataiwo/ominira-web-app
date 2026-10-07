import { useCallback, useMemo, useState } from "react";
import type { Note } from "@/lib/api/types";
import { useSessionStore } from "@/stores/session-store";
import { useAnnotations } from "./useAnnotations";
import { topLevelNotes } from "./noteThread";
import { annotationSortKey, generalNoteSortKey, type FeedSort } from "./feedSort";
import { buildAnnotationFeedEntries, type FeedEntry, type FeedLocator } from "./annotationFeed";

/** Which entries the panel actually renders — "notes" (labeled "Public
 * notes") narrows down to entries with at least one note, "highlights"
 * (labeled "Your highlights") is the complement, bare highlights only,
 * nothing discussed yet. Every entry is exactly one or the other (never
 * both, never neither), so these two exhaust the feed on their own — no
 * third "all" option needed. Purely a display filter — totals below are
 * always computed from the full, unfiltered set, so the header badge/
 * subtitle never appears to shrink just because the reader narrowed their
 * own view. "chat" is the live room's chat (app/components/room/RoomChat),
 * offered only while you're in the room on this book; no feed items. */
export type AnnotationFeedFilter = "notes" | "highlights" | "chat";

/** One row the panel actually renders — a highlighted passage's discussion
 * (with its own chapter/section `label` for context — see FeedEntry) or a
 * book-level General discussion note (no passage, so no `label` of its
 * own; the panel supplies "General discussion" directly). A single flat,
 * sortable list rather than the old per-chapter grouping — every entry
 * carries its own context label inline instead, so "where is this from"
 * lives on the entry, not on a section it sits under (see
 * BookAnnotationFeedPanel). */
export type FeedItem = { kind: "highlight"; entry: FeedEntry } | { kind: "general"; note: Note };

/** Another reader who has written in this material, for NotesFeedFab's
 * social rail. `entries` are where their notes sit, in book order — only the
 * current run's when `here`, and empty when all they wrote was general
 * discussion. `count` is every note and reply they wrote, book-wide.
 * `latest` is their newest note's createdAt. */
export type NoteAuthor = { author: Note["author"]; entries: FeedEntry[]; here: boolean; count: number; latest: string };

function feedItemKey(item: FeedItem, notes: Note[], sort: "recent" | "top"): number {
  return item.kind === "highlight"
    ? annotationSortKey(item.entry.annotation, sort)
    : generalNoteSortKey(item.note, notes, sort);
}

/**
 * Owns the book-wide annotation feed panel's own state — open/closed, the
 * flat sorted view-model, and which of the two tabs the reader currently
 * has selected. Defaults to "notes" — the feed's whole point is surfacing
 * discourse worth re-reading, and a heavily-highlighted book would
 * otherwise bury that under every bare highlight on first open. Which
 * highlight's thread is doing what (composer/menu/edit) is each
 * FeedHighlightThread's own concern via useThreadInteraction, not
 * centralized here — there's no single "active" entry for this panel.
 */
export function useBookAnnotationFeed({
  materialId,
  locate,
}: {
  materialId: string;
  /** Where each block sits — see FeedLocator. Memoize it: the feed rebuilds
   * whenever it changes. */
  locate: FeedLocator;
}) {
  const { notes, allAnnotations } = useAnnotations(materialId);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<AnnotationFeedFilter>("notes");
  // "Book order" — General discussion first, then every highlight in
  // spine order — is the default: it's this panel's own natural browsing
  // order (General discussion first since it's not tied to any one place
  // in the book, then the book itself front to back), not an engagement
  // ranking a reader has to opt into. Only meaningful on the "notes" tab —
  // "Your highlights" has no discussion to rank by engagement/activity
  // anyway, so it always stays in book order regardless of this value (see
  // `items` below).
  const [sort, setSort] = useState<FeedSort>("book");
  // One comrade the panel is narrowed to — opened from their face on the
  // social rail. Only ever meaningful on the "notes" tab.
  const [authorId, setAuthorId] = useState<string | null>(null);

  // Every entry carries its own run label (chapter, page, heading), so the
  // panel groups consecutive runs itself — no separate grouping pass here.
  const flatEntries: FeedEntry[] = useMemo(() => buildAnnotationFeedEntries(allAnnotations, locate), [allAnnotations, locate]);

  const items: FeedItem[] = useMemo(() => {
    if (filter === "chat") return [];
    const byAuthor = (n: Note) => n.author.readerId === authorId;
    const highlightItems: FeedItem[] = flatEntries
      .filter((e) => (filter === "notes" ? e.annotation.notes.length > 0 : e.annotation.notes.length === 0))
      .filter((e) => !authorId || e.annotation.notes.some(byAuthor))
      .map((entry) => ({ kind: "highlight", entry }));

    if (filter !== "highlights") {
      // Book-level notes — no ranges, so they never entered `allAnnotations`
      // in the first place (useAnnotations' own bucketByPassage only ever
      // visits a note's `ranges`, which is empty here) and have no
      // passage/section to carry a `label` the way a FeedEntry does; the
      // panel supplies "General discussion" for these directly. "Your
      // highlights" never includes these — a general note is always an
      // actual note, never a bare highlight.
      const generalNotes = topLevelNotes(notes).filter(
        (n) => n.ranges.length === 0 && (!authorId || byAuthor(n) || notes.some((r) => r.parentId === n.id && byAuthor(r)))
      );

      if (sort === "book") {
        // General discussion first (oldest first among themselves — read
        // start to finish, same convention NoteSortMode's own
        // "chronological" already uses within one thread), then every
        // highlight in the book's own spine order (`highlightItems` is
        // already that order, unsorted) — this mode doesn't rank items
        // against each other at all, so there's no `feedItemKey` call
        // here.
        const generalItems: FeedItem[] = [...generalNotes]
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((note) => ({ kind: "general", note }));
        return [...generalItems, ...highlightItems];
      }

      const generalItems: FeedItem[] = generalNotes.map((note) => ({ kind: "general", note }));
      return [...highlightItems, ...generalItems].sort(
        (a, b) => feedItemKey(b, notes, sort) - feedItemKey(a, notes, sort)
      );
    }

    // "Your highlights" has no discussion to rank by engagement/activity —
    // stays in book order (flatEntries' own spine order), same as
    // browsing the book itself.
    return highlightItems;
  }, [flatEntries, notes, filter, sort, authorId]);

  const totalNoteCount =
    flatEntries.reduce((sum, e) => sum + e.annotation.notes.length, 0) +
    // Independent of `filter` (unlike `items` above) — this header count
    // should never appear to shrink just because the reader is on the
    // "Your highlights" tab, same reasoning as passageCount below.
    topLevelNotes(notes)
      .filter((n) => n.ranges.length === 0)
      .reduce((sum, n) => sum + 1 + notes.filter((r) => r.parentId === n.id).length, 0);
  const passageCount = flatEntries.length;

  // Every other reader who has written here, with where — the same notes
  // totalNoteCount counts, minus the reader's own (seeing yourself back
  // invites nothing). General discussion and its replies add a face but no
  // entry.
  const readerId = useSessionStore((s) => s.readerId);
  const { authorsById, othersNoteCount } = useMemo(() => {
    const byId = new Map<string, { author: Note["author"]; entries: FeedEntry[]; count: number; latest: string }>();
    let count = 0;
    const add = (n: Note, entry?: FeedEntry) => {
      if (n.author.readerId === readerId) return;
      count++;
      let a = byId.get(n.author.readerId);
      if (!a) byId.set(n.author.readerId, (a = { author: n.author, entries: [], count: 0, latest: n.createdAt }));
      a.count++;
      if (n.createdAt > a.latest) a.latest = n.createdAt;
      if (entry && a.entries.at(-1) !== entry) a.entries.push(entry);
    };
    for (const e of flatEntries) for (const n of e.annotation.notes) add(n, e);
    const generalIds = new Set(
      topLevelNotes(notes)
        .filter((n) => n.ranges.length === 0)
        .map((n) => n.id)
    );
    for (const n of notes) if (generalIds.has(n.id) || (n.parentId && generalIds.has(n.parentId))) add(n);
    return { authorsById: byId, othersNoteCount: count };
  }, [flatEntries, notes, readerId]);

  /** Other readers' faces for the run the reader is in: whoever wrote there
   * first, then everyone else who wrote in the book, newest activity first
   * within each. */
  const noteAuthors = useCallback(
    (sectionId: string | undefined): NoteAuthor[] =>
      [...authorsById.values()]
        .map(({ author, entries, count, latest }) => {
          const hereEntries = sectionId ? entries.filter((e) => e.sectionId === sectionId) : [];
          const here = hereEntries.length > 0;
          return { author, entries: here ? hereEntries : entries, here, count, latest };
        })
        .sort((a, b) => Number(b.here) - Number(a.here) || b.latest.localeCompare(a.latest)),
    [authorsById]
  );

  /** Opens the feed — narrowed to one comrade's notes when given their id. */
  const openFeed = useCallback((author?: string) => {
    setAuthorId(author ?? null);
    if (author) setFilter("notes");
    setOpen(true);
  }, []);
  /** Opens the feed on the room chat. */
  const openChat = useCallback(() => {
    setAuthorId(null);
    setFilter("chat");
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setAuthorId(null);
  }, []);
  const clearAuthor = useCallback(() => setAuthorId(null), []);
  const focusedAuthor = (authorId && authorsById.get(authorId)) || null;

  return {
    open,
    items,
    // The material's whole flat note list — GeneralNoteThread needs it to
    // look up each general note's own replies (repliesFor), same as every
    // other thread renderer already does with allAnnotations' per-
    // annotation notes; general notes just have nowhere else to source it
    // from since they never made it into an Annotation.
    notes,
    filter,
    setFilter,
    sort,
    setSort,
    totalNoteCount,
    passageCount,
    noteAuthors,
    othersNoteCount,
    focusedAuthor,
    clearAuthor,
    openFeed,
    openChat,
    close,
  };
}

export type BookAnnotationFeed = ReturnType<typeof useBookAnnotationFeed>;
