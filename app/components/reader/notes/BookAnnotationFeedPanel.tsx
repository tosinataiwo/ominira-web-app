"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import NoResults from "@/app/components/shared/NoResults";
import ReaderAvatar from "@/app/components/shared/ReaderAvatar";
import { comradeName } from "@/lib/reader/authorDisplay";
import type { FeedEntry } from "@/lib/reader/annotationFeed";
import type { AnnotationFeedFilter, FeedItem } from "@/lib/reader/useBookAnnotationFeed";
import type { Note } from "@/lib/api/types";
import { useCreateNote } from "@/lib/community/useNoteMutations";
import UnderlineTabs from "../../UnderlineTabs";
import PanelShell from "./PanelShell";
import LiveChip from "@/app/components/room/LiveChip";
import FeedHighlightThread from "./FeedHighlightThread";
import GeneralNoteThread from "./GeneralNoteThread";
import NoteComposer from "./NoteComposer";
import { notesLabel } from "../ReaderPresence";
import { roomChatUnread, useRoomStore } from "@/stores/room-store";

// The room's chat tab, loaded only while you're in the room on this book.
const RoomChatList = dynamic(() => import("@/app/components/room/RoomChat").then((m) => m.RoomChatList), { ssr: false });
const RoomChatComposer = dynamic(() => import("@/app/components/room/RoomChat").then((m) => m.RoomChatComposer), {
  ssr: false,
});

// Same two-tab split as book details' own Table of contents/Community notes
// switch (UnderlineTabs), just this panel's own two views — every entry is
// exactly one or the other (see AnnotationFeedFilter's own doc comment), so
// there's no third "All" to combine them back into. Labeled just "Notes",
// not "Public notes" — this tab's own data (GET /api/materials/{id}/notes)
// already mixes in the reader's own private notes/replies alongside public
// ones (visibleToFilter: public OR mine), so "Public" was never quite
// accurate here; each private entry marks itself instead (see AuthorRow's
// own "Only you" chip).
const FILTER_OPTIONS: { value: AnnotationFeedFilter; label: string }[] = [
  { value: "notes", label: "Notes" },
  { value: "highlights", label: "Your highlights" },
];

/** A stable DOM id per item — looked up via `document.getElementById` in an
 * effect to position the panel on open, same reasoning as the note panel's
 * own composer-focus effects: this project's stricter ref-access lint rule
 * rejects a ref callback produced inside a `.map()`, unlike a single
 * non-looped element. */
function feedItemElementId(item: FeedItem): string {
  return item.kind === "highlight" ? `feed-item-${item.entry.annotation.id}` : `feed-item-${item.note.id}`;
}

type FeedItemRun = { key: string; label: string; items: FeedItem[] };

/** Which category an item belongs to — "general" for every General
 * discussion note (they're all one category together), a highlight's own
 * `sectionId` otherwise. */
function feedItemCategoryKey(item: FeedItem): string {
  return item.kind === "general" ? "general" : item.entry.sectionId;
}

function feedItemCategoryLabel(item: FeedItem): string {
  return item.kind === "general" ? "General discussion" : item.entry.label;
}

/** Buckets a flat, already-grouped `items` list (General discussion first,
 * then every highlight in spine order — chapters are necessarily
 * contiguous runs there) into consecutive same-category runs — one pass,
 * no re-sorting. Each run renders under a single FeedItemLabel (with its
 * own count) instead of the label repeating above every item. */
function groupFeedItemsByCategory(items: FeedItem[]): FeedItemRun[] {
  const runs: FeedItemRun[] = [];
  for (const item of items) {
    const key = feedItemCategoryKey(item);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.items.push(item);
    else runs.push({ key, label: feedItemCategoryLabel(item), items: [item] });
  }
  return runs;
}

/** One category's own context label — which chapter a run of highlights'
 * passages live in, or "General discussion" for a run of book-level
 * notes — plus that run's own count, same "N topics"/"N highlights"
 * convention this feed's per-section headers used before it flattened
 * into one continuous list. A page-level section header in spirit, just
 * without the sticky per-section grouping the feed used to have:
 * everything still scrolls as one continuous, single-screen feed
 * (expand/collapse a thread in place, same as the standalone note panel),
 * this only stops the label itself from repeating above every single
 * item. Full-bleed (-mx-5/px-5 cancels the body's own side padding) — a
 * thin bar spanning the panel's full width, not padded/inset to match the
 * note card sitting under it, so it reads as this run's own running head
 * rather than another line inside the first card. No icon — the text
 * alone (General discussion vs. an actual chapter title) already tells
 * the two kinds apart, so one wasn't earning its keep. Plain text over a
 * border-bottom for now, same treatment this feed already used before a
 * background tint was tried here — a background sized to just the text
 * (not the full-bleed bar) is worth another pass later, but isn't this
 * one. */
function FeedItemLabel({ run, filter }: { run: FeedItemRun; filter: AnnotationFeedFilter }) {
  const count = run.items.length;
  const noun = filter === "notes" ? (count === 1 ? "note" : "notes") : count === 1 ? "highlight" : "highlights";
  return (
    <div className="-mx-5 mb-2 flex items-center justify-between gap-3 border-b border-[var(--reader-border)] px-5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--reader-text-subtle)]">
      <span className="min-w-0 flex-1 truncate">{run.label}</span>
      <span className="flex-none normal-case tracking-normal text-[var(--reader-text-subtle)]">
        {count} {noun}
      </span>
    </div>
  );
}

/** The book-wide annotation feed — every mark of any kind, grouped under a
 * context label per run (which chapter, or General discussion — see
 * FeedItemLabel), each item's own full, real interactive thread (see
 * FeedHighlightThread) sitting under it — a bare
 * highlight renders as just the quote and a collapsed "add a note"
 * composer, same component either way. One continuous, single-screen feed:
 * a thread expands/collapses in place (its own ReplyButton toggle), it
 * never drills into a separate view — same "the discourse happens right
 * here" shape as the standalone note panel. Always in `items`' own default
 * order (General discussion first, then every highlight in spine order) —
 * no sort control here; the Top/Recent toggle this briefly had kept
 * fighting with UnderlineTabs' own alignment, so it's shelved for now (see
 * useBookAnnotationFeed, which still computes the "book" order this
 * defaults to — a real sort control can come back once it has a spot that
 * doesn't fight the tabs). Opening the panel scrolls once to wherever the
 * reader currently is in the book; browsing the feed itself never
 * re-scrolls on its own. */
export default function BookAnnotationFeedPanel({
  materialId,
  items,
  notes,
  filter,
  onFilterChange,
  activeSectionId,
  onJump,
  getPassageText,
  panelType,
  onClose,
  targetNoteId,
  targetThreadId,
  focusedAuthor,
  onClearAuthor,
}: {
  materialId: string;
  items: FeedItem[];
  /** The material's whole flat note list — GeneralNoteThread's own source
   * for each general note's replies (see its doc comment); nothing else
   * here needs it. */
  notes: Note[];
  filter: AnnotationFeedFilter;
  onFilterChange: (filter: AnnotationFeedFilter) => void;
  /** The run the reader is in now — the panel opens scrolled to it. */
  activeSectionId?: string;
  onJump: (entry: FeedEntry) => void;
  getPassageText: (passageId: string) => string;
  panelType?: "side" | "sheet";
  onClose: () => void;
  /** Deep-link from push notification for a general note — scrolls to and
   * flashes that note instead of the default active-section positioning. */
  targetNoteId?: string;
  /** Specific thread (root note id) whose replies should be fully shown
   * when deep-linked from a notification. Duplicates targetNoteId for
   * general notes, separate for anchored highlights. */
  targetThreadId?: string;
  /** The comrade the feed is narrowed to, opened from their face. */
  focusedAuthor: { author: Note["author"]; count: number } | null;
  onClearAuthor: () => void;
}) {
  const createNote = useCreateNote(materialId);
  // Room chat sits beside the two tabs while you're in the room on this
  // book, with its unread count (spec §3.1); leaving the room leaves it.
  const chatUnread = useRoomStore((s) => roomChatUnread(s, materialId));
  const inRoom = chatUnread !== null;
  const onChat = filter === "chat" && inRoom;
  useEffect(() => {
    if (filter === "chat" && !inRoom) onFilterChange("notes");
  }, [filter, inRoom, onFilterChange]);
  const tabOptions = inRoom
    ? [
        ...FILTER_OPTIONS,
        {
          value: "chat" as const,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              Room chat
              {chatUnread > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] leading-none tabular-nums text-white">
                  {chatUnread > 99 ? "99+" : chatUnread}
                </span>
              )}
            </span>
          ),
        },
      ]
    : FILTER_OPTIONS;
  const tabs = (
    <UnderlineTabs
      bare
      options={tabOptions}
      value={filter}
      onChange={(next) => {
        onClearAuthor();
        onFilterChange(next as AnnotationFeedFilter);
      }}
    />
  );
  const [generalComposerError, setGeneralComposerError] = useState<string | null>(null);
  const runs = useMemo(() => groupFeedItemsByCategory(items), [items]);
  // Positioning: fires once per "panel just opened" but also waits for items
  // to arrive when deep-linking to a specific general note. The panel mounts
  // synchronously with `noteFeed.open=true`, but `items` may still be
  // fetching from useAnnotations — so we retry until the target is found or
  // we fall back to the default active-section scroll.
  const hasPositionedRef = useRef(false);
  useEffect(() => {
    if (hasPositionedRef.current) return;
    // One comrade's notes read top to bottom — no mid-feed positioning.
    if (focusedAuthor) {
      hasPositionedRef.current = true;
      return;
    }
    // Deep-link to a specific note takes precedence over position-based scroll.
    if (targetNoteId) {
      const target = items.find((item) => feedItemElementId(item) === `feed-item-${targetNoteId}`);
      if (target) {
        hasPositionedRef.current = true;
        requestAnimationFrame(() => {
          const el = document.getElementById(feedItemElementId(target));
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          if (el) {
            el.classList.add("reader-jump-flash");
            setTimeout(() => el.classList.remove("reader-jump-flash"), 2400);
          }
        });
        return;
      }
      // If items are still loading and empty, wait for them — don't mark as
      // positioned yet. Once items populate, this effect re-runs and finds it.
      if (items.length === 0) return;
      // Item not found after load — try direct DOM fallback for robustness.
      hasPositionedRef.current = true;
      requestAnimationFrame(() => {
        const el = document.getElementById(`feed-item-${targetNoteId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("reader-jump-flash");
          setTimeout(() => el.classList.remove("reader-jump-flash"), 2400);
        }
      });
      return;
    }
    // No deep link — need at least some items before choosing default target.
    if (items.length === 0) return;
    hasPositionedRef.current = true;
    // Default: first item whose passage is in the reader's current chapter —
    // `items` may be sorted by activity/engagement now rather than book
    // order, so this is a search, not just "the first group" the way it
    // was when chapters were their own sections.
    const target = items.find((item) => item.kind === "highlight" && item.entry.sectionId === activeSectionId);
    if (!target) return;
    requestAnimationFrame(() => {
      document.getElementById(feedItemElementId(target))?.scrollIntoView({ behavior: "auto", block: "start" });
    });
  }, [items, targetNoteId, activeSectionId, focusedAuthor]);

  // Narrowing to someone else from the header starts their notes at the top.
  const focusedId = focusedAuthor?.author.readerId;
  const listTopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusedId) listTopRef.current?.scrollIntoView({ block: "start" });
  }, [focusedId]);

  return (
    <PanelShell
      panelType={panelType}
      onClose={onClose}
      // Adds overflow-x-hidden on top of PanelShell's own default body
      // class — this panel's own content should never need to scroll
      // sideways, but `overflow-y-auto` alone (the default) leaves
      // overflow-x at its own computed value, which the CSS spec forces to
      // `auto` too the moment overflow-y isn't `visible`. Any stray
      // horizontal overflow (a single pixel of rounding from
      // FeedItemLabel's own -mx-5 bleed is enough) was silently growing a
      // second, sand-colored (.om-scroll's own scrollbar-thumb color)
      // horizontal scrollbar across the bottom of the list — the "weird
      // background" band sitting above the footer composer.
      bodyClassName="om-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain px-5 pb-10 flex flex-col gap-3.5"
      footer={
        onChat ? (
          <RoomChatComposer materialId={materialId} />
        ) : (
          // Bottom-docked and independent of `filter` — a general, book-level
          // thought isn't specific to a passage or a selection, so it stays
          // reachable the same way regardless of which tab the reader's
          // browsing (highlights included), the same way a chat app's own
          // message input never disappears depending on which channel view
          // you're scrolled through.
          <div className="flex flex-col gap-2">
            <NoteComposer
              initialText=""
              placeholder="Add a note"
              startCollapsed
              showMemberPrompt
              action="note"
              draftKey={`book-${materialId}`}
              onSave={(content, visibility) => {
                setGeneralComposerError(null);
                createNote.mutate(
                  { ranges: [], content, visibility },
                  { onError: () => setGeneralComposerError("Couldn't save your note — check your connection and try again.") }
                );
              }}
            />
            {generalComposerError && (
              <p className="m-0 text-[11px] text-[var(--reader-text-muted)]">{generalComposerError}</p>
            )}
          </div>
        )
      }
      headerMenu={<LiveChip materialId={materialId} />}
      // No "Notes & Highlights" title — the tabs already say what the panel
      // holds, so they are the header, sharing its line with Close. In the
      // room there are three tabs and the Live chip, too many for one line:
      // "Notes" and the chip head the panel, the tabs get their own row
      // (spec §3.1).
      title={inRoom ? "Notes" : undefined}
      tabs={inRoom ? undefined : tabs}
      subheader={inRoom ? <div className="px-5 pt-2.5">{tabs}</div> : undefined}
    >
      {onChat ? (
        <RoomChatList />
      ) : (
        <>
          {focusedAuthor && (
            <div
              ref={listTopRef}
              className="reader-menu-in mt-3 flex items-center gap-2.5 rounded-full bg-[color-mix(in_srgb,var(--reader-accent)_10%,transparent)] py-1 pl-1 pr-1.5"
            >
              <ReaderAvatar pseudonym={focusedAuthor.author.pseudonym} avatar={focusedAuthor.author.avatar} size={26} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--reader-text-muted)]">
                <span className="font-semibold text-[var(--reader-text)]">{comradeName(focusedAuthor.author.pseudonym)}</span>
                {" · "}
                {notesLabel(focusedAuthor.count)}
              </span>
              <button
                type="button"
                onClick={onClearAuthor}
                className="flex flex-none cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold text-[var(--reader-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--reader-accent)_12%,transparent)]"
              >
                All notes
                <X size={13} strokeWidth={2.5} />
              </button>
            </div>
          )}
          {items.length === 0 ? (
            <NoResults
              className="mt-5"
              message={
                filter === "notes"
                  ? "No notes in this book yet — be the first to say something."
                  : "You have no private highlights in this book"
              }
            />
          ) : (
            // pt-4 — PanelShell's own body has no top padding by default (its
            // bottom padding is for scroll clearance above the footer, not a
            // symmetric pair), so without this the first run's label sits
            // flush against the subheader's own bottom border with no breathing
            // room at all.
            <div className="flex flex-col pt-4">
              {runs.map((run, runIndex) => (
                <div key={run.key} className={runIndex === 0 ? undefined : "mt-6"}>
                  <FeedItemLabel run={run} filter={filter} />
                  {/* Items within the same run sit closer together (gap-4)
                      than the space reserved above the next run (mt-6 on the
                      wrapper above) — same "tighter within a group, looser
                      between groups" convention as the general run's own
                      spacing before it was flattened here. */}
                  <div className="flex flex-col gap-4">
                    {run.items.map((item) => (
                      <div key={feedItemElementId(item)} id={feedItemElementId(item)}>
                        {item.kind === "highlight" ? (
                          <FeedHighlightThread
                            materialId={materialId}
                            entry={item.entry}
                            getPassageText={getPassageText}
                            onJump={onJump}
                            targetThreadId={targetThreadId}
                          />
                        ) : (
                          <GeneralNoteThread
                            materialId={materialId}
                            note={item.note}
                            allNotes={notes}
                            initialShowAll={targetNoteId === item.note.id || targetThreadId === item.note.id}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </PanelShell>
  );
}
