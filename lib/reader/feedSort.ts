import type { Note } from "@/lib/api/types";
import type { Annotation } from "@/stores/library-store";
import { lastActivityAt, repliesFor } from "./noteThread";

/** "book" — General discussion first, then every highlight in spine
 * order, same as browsing the book itself (`useFeed`'s own
 * default, and currently the only one actually reachable — there's no UI
 * control for this anymore; a native `<select>` here fought mobile
 * Safari's 16px-floor anti-zoom rule and looked oversized, so it was
 * dropped rather than rebuilt as something else right away) — plus the
 * same two engagement sorts as CommunityFeedSortToggle's own
 * `CommunityFeedSort` (the home community feed): "Top" (most engaged
 * with) or "Recent" (most recently active), kept here dormant for when a
 * sort control returns. Computed client-side from annotations already in
 * memory, unlike the community feed's own server `?sort=` param — this
 * panel already has everything it needs loaded. */
export type FeedSort = "book" | "recent" | "top";

/** A rough "how much is happening here" score for "Top" — every note (root
 * or reply) counts as participation on its own, on top of whatever
 * reactions it drew. Never shown to a reader as a number; only used to rank
 * topics against each other. */
function engagementScore(notes: Note[]): number {
  return notes.reduce((sum, n) => sum + 1 + n.reactionCount, 0);
}

/** One highlight's own sort key — `annotation.savedAt` is already its
 * last-activity epoch (see Annotation's own doc comment), so "Recent" reads
 * straight off it; "Top" scores every note the highlight has drawn,
 * top-level and replies alike. Never called for "book" — see
 * `generalNoteSortKey`'s own doc comment. */
export function annotationSortKey(annotation: Annotation, sort: "recent" | "top"): number {
  return sort === "recent" ? annotation.savedAt : engagementScore(annotation.notes);
}

/** One General discussion note's own sort key — mirrors
 * `annotationSortKey`, just sourced from a flat note + its replies instead
 * of an Annotation. Never called for "book" — that mode doesn't rank
 * notes against each other at all (see useFeed's own
 * `items`). */
export function generalNoteSortKey(note: Note, allNotes: Note[], sort: "recent" | "top"): number {
  const replies = repliesFor(allNotes, note.id);
  return sort === "recent" ? lastActivityAt(note, replies) : engagementScore([note, ...replies]);
}
