"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, EllipsisVertical } from "lucide-react";
import type { Note } from "@/lib/api/types";
import { useIsOwnNote } from "@/lib/reader/currentAuthor";
import AuthorAvatar from "./AuthorAvatar";
import AuthorRow from "./AuthorRow";
import NoteContent from "./NoteContent";
import ReactionButton from "./ReactionButton";
import ReplyButton from "./ReplyButton";
import BookmarkButton from "@/app/components/shared/BookmarkButton";
import NoteComposer from "./NoteComposer";
import HighlightCard from "./HighlightCard";
import EntryMenu from "./EntryMenu";
import ReplyEntry from "./ReplyEntry";
import type { ThreadActions, ThreadUIState } from "@/lib/reader/threadTypes";

// Reply threads default to their first two entries, with the rest behind a
// "Show N more" expander — matches the redesigned Thread View, and keeps a
// long-running thread from dominating the card the moment it's expanded.
const COLLAPSED_REPLY_COUNT = 5;

/** One top-level note ("comment") on a highlighted passage, plus its own
 * flat reply thread — the single source of truth for this whole unit,
 * reused wherever a note+thread appears: the home feed (`header`/`quote`
 * both supplied, since one feed card is one fully self-contained object),
 * the book-wide annotation panel and the single-note deep view (both
 * hoist one quote once above several of these cards, so they omit
 * `header`/`quote` here and pass their own instead).
 *
 * `ReplyButton` (the "N replies" pill) is the root note's one deliberate
 * "I want to reply" trigger — same role each reply's own inline "Reply"
 * button plays for it (see ReplyEntry). No composer exists until a reader
 * clicks one of those, and it then mounts inline right under whichever
 * entry — root or a specific reply — was clicked (`ui.activeComposerFor`
 * tracks that one target; see threadTypes' own doc comment). Exactly one
 * composer is ever active across the whole thread, so targeting a new
 * entry implicitly closes whichever one was open. */
export default function NoteThreadCard({
  header,
  attachment,
  quote,
  note,
  replies,
  expanded,
  initialShowAll,
  focusReplyId,
  onToggleExpand,
  ui,
  actions,
}: {
  /** Book context — home feed only. Either `NoteBookContext` (cover/title/
   * author, plus the excerpt stacked beneath it when this note is anchored
   * to a highlighted range) or, for the book-details tab and every in-
   * reader panel, omitted entirely since those are already scoped to one
   * book. Mutually exclusive with `quote` below. */
  header?: ReactNode;
  /** Book context with no highlighted passage — a note about the document
   * as a whole. Unlike `header` (a passage the note responds to, so it
   * leads), this renders after the note's body, where NoteContent puts a
   * link preview: the note reads first, the document is where you go next.
   * Mutually exclusive with `header` and `quote`. */
  attachment?: ReactNode;
  /** The highlighted excerpt this note is attached to, with no book cover
   * — the book-wide annotation panel and single-note view, both already on
   * that book's own page. Same reasoning as `citation` but without the
   * per-card cover/title/author that would just repeat the page it's on. */
  quote?: string;
  note: Note;
  /** This note's own replies, already chronological. */
  replies: Note[];
  expanded: boolean;
  /** When deep-linked from a notification, show all replies immediately
   * instead of collapsed to 2. */
  initialShowAll?: boolean;
  /** The one reply a deep link came for (a reply notification names the
   * reply, not the thread): it's scrolled into view and washed once on
   * mount, and the thread opens uncollapsed so it can't be hiding behind
   * "Show N more". */
  focusReplyId?: string;
  onToggleExpand: () => void;
  ui: ThreadUIState;
  actions: ThreadActions;
}) {
  const own = useIsOwnNote(note);
  const isEditing = ui.editingId === note.id;
  const isMenuOpen = ui.activeMenuFor === note.id;
  const isReplyingToRoot = ui.activeComposerFor === note.id && ui.editingId === null;
  const [showAllReplies, setShowAllReplies] = useState(initialShowAll ?? Boolean(focusReplyId));
  const focusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // "center", not the default "start": a reply landing flush against the
    // top of the viewport reads as the beginning of the thread rather than
    // as one entry inside it.
    if (focusReplyId) focusRef.current?.scrollIntoView({ block: "center" });
  }, [focusReplyId]);
  const visibleReplies = showAllReplies ? replies : replies.slice(0, COLLAPSED_REPLY_COUNT);
  const hiddenReplyCount = Math.max(0, replies.length - visibleReplies.length);

  return (
    <div className="flex flex-col gap-3">
      {/* The avatar sits beside just the name/time row (`items-center` here
          pairs their vertical centers — the row below stretches to the
          height of the taller multi-line content next to it, so aligning
          against that whole block instead would leave the avatar pinned to
          its top edge rather than centered on the name it belongs to).
          Everything else (header/quote, body, attachment, reactions) runs the full
          width below, not indented under the avatar. */}
      <div className="flex min-w-0 items-center gap-1 sm:gap-3">
        <AuthorAvatar author={note.author} />
        <div className="min-w-0 flex-1">
          <AuthorRow
            name={note.author.pseudonym}
            savedAt={Date.parse(note.createdAt)}
            city={note.author.city}
            topics={note.topics}
            isPrivate={own && note.visibility === "private"}
            menu={
              own ? (
                // self-center: this row (AuthorRow) aligns its own children
                // by text baseline, which a plain icon button never
                // establishes cleanly — left to `items-baseline`, the
                // button could inflate the row taller than the avatar
                // beside it, throwing off AuthorAvatar's own centering
                // against this row. self-center opts this one non-text
                // child out of that baseline calculation.
                <div className="relative ml-auto flex-none self-center">
                  <button
                    onClick={() => ui.toggleMenu(isMenuOpen ? null : note.id)}
                    className="flex items-center bg-transparent border-none cursor-pointer text-[var(--reader-text-muted)] p-0.5"
                  >
                    <EllipsisVertical size={15} />
                  </button>
                  {isMenuOpen && (
                    <EntryMenu
                      isOwn={own}
                      isTextEntry={note.content.kind === "text"}
                      onEdit={() => {
                        ui.startEdit(note.id);
                        ui.toggleMenu(null);
                      }}
                      onDelete={() => {
                        actions.delete(note.id);
                        ui.toggleMenu(null);
                      }}
                      onClose={() => ui.toggleMenu(null)}
                    />
                  )}
                </div>
              ) : undefined
            }
          />
        </div>
      </div>

      {/* Full width, not indented under the avatar — only the identity row
          above sits beside it. */}
      <div className="flex min-w-0 flex-col gap-3">
        {header}

        {/* No onJump here — the home feed's own header above already
            carries book/section context, and there's nowhere local for
            "show in passage" to jump to from this card. Still gets the
            same universal preview/"See more" every other HighlightCard
            does. */}
        {quote && <HighlightCard text={quote} />}

        {/* min-w-0: this is a flex item of the outer `flex flex-col`
            above — without it, a long unbroken run inside NoteContent (a
            URL) sets this column's own automatic minimum width to that
            run's full length, overflowing the panel instead of letting
            NoteContent's own wrap utilities actually engage. */}
        <div className="flex min-w-0 flex-col">
          {isEditing ? (
            <NoteComposer
              initialText={note.content.kind === "text" ? note.content.text : ""}
              initialVisibility={note.visibility}
              onCancel={() => ui.startEdit(null)}
              onSave={(content, visibility) => {
                actions.saveEdit(note.id, content, visibility);
                ui.startEdit(null);
              }}
            />
          ) : (
            <NoteContent content={note.content} />
          )}
          {attachment && <div className="mt-3 min-w-0">{attachment}</div>}
          {/* No gap on the column above: whatever renders before this row —
              body text, a link preview, a book attachment, or nothing at
              all — never carries its own bottom spacing. This row's own
              mt-3 is the single, unconditional source of the space above
              it, so that space is always the same 12px no matter what's
              above. */}
          <div className="mt-4 flex items-center gap-3.5">
            <ReactionButton count={note.reactionCount} reacted={note.reactedByMe} onToggle={() => actions.toggleReaction(note.id)} />
            {/* One control, not two: existing replies are already shown by
                default wherever this card appears (useThreadInteraction
                seeds every root expanded), so there's nothing left for a
                separate disclosure click to do in practice — this pill is
                the deliberate "I want to reply" trigger for the root note
                itself, same role each reply's own inline "Reply" button
                plays for it (see ReplyEntry). `onToggleExpand` is a no-op
                in the now-common case (already expanded); it only matters
                if some future caller ever seeds a thread collapsed. */}
            <ReplyButton
              count={replies.length}
              expanded={expanded || isReplyingToRoot}
              onToggle={() => {
                if (!expanded) onToggleExpand();
                ui.toggleComposer(note.id);
              }}
            />

            {/* ml-auto, not part of the react/reply cluster: those two are
                what a reader does *to* the conversation, this is what they
                do with it for themselves. Pushed to the row's trailing
                edge so it reads as a separate, private act — and it stays
                countless on purpose (see BookmarkButton), which is also
                what keeps it from looking like a third social metric
                sitting next to two real ones.

                Hidden on your own post, same rule 1 BookListRow applies to
                your own uploads: your posts are already collected on your
                profile, so saving one is an offer to do something that's
                already true. Unlike a book row this stays unconditionally
                visible otherwise (rule 3) — a post has no detail page to
                fall back to, so hover-reveal here would leave it
                unsavable on touch entirely. */}
            {!own && (
              <BookmarkButton
                saved={note.bookmarkedByMe}
                onToggle={() => actions.toggleBookmark(note.id, note.bookmarkedByMe)}
                className="ml-auto"
              />
            )}
          </div>

          {/* Mounts right here, under the root note's own action row — not
              in some shared slot down past every reply — so it's obvious
              this composer targets the root note itself. Same explicit
              mt-3 as the reaction row above, for the same reason: this
              column has no gap, so every bit of vertical spacing in it is
              an explicit margin on the element that needs it, never
              implicit from a neighbor. */}
          {isReplyingToRoot && (
            <div className="mt-3">
              <NoteComposer
                initialText=""
                placeholder={`Reply to ${note.author.pseudonym}`}
                showMemberPrompt
                action="reply"
                onCancel={() => ui.toggleComposer(note.id)}
                onSave={(content, visibility) => actions.reply(note.id, content, visibility)}
              />
            </div>
          )}
        </div>
      </div>

      {expanded && (
        // A tree, so replies read as belonging to this note: a trunk drops
        // from the root avatar's center (left-[15px] — AuthorAvatar is 32px)
        // and a rounded elbow branches off it into each reply's avatar,
        // stopping at the last one. Deliberately shallow for phone width:
        // the thread model is capped at two levels (a reply, or a reply to a
        // reply — see `depth`), so the indent can never compound, and a
        // depth-2 reply is told apart by a longer elbow into ReplyEntry's
        // own small extra indent rather than a second nested trunk.
        <div className="flex flex-col gap-3">
          {visibleReplies.map((reply, index) => {
            const replyingToName = reply.replyingToId
              ? replies.find((r) => r.id === reply.replyingToId)?.author.pseudonym
              : undefined;
            const depth = replyingToName ? 2 : 1;
            const isReplyingToThis = ui.activeComposerFor === reply.id && ui.editingId === null;
            const isLast = index === visibleReplies.length - 1;
            // Each depth-1 reply starts a fresh little sub-thread of its own
            // (itself plus whichever depth-2 replies address it) — extra top
            // spacing marks where one of those groups ends and the next
            // begins, including above the first, away from the root note's
            // own reaction/reply row.
            const isNewRootReply = depth === 1;
            return (
              <div key={reply.id} className={`relative pl-8 sm:pl-10 ${isNewRootReply ? "pt-3" : ""}`}>
                {/* Trunk through this entry and the gap-3 below it; the last
                    entry's elbow is where the trunk ends. */}
                {!isLast && (
                  <span className="absolute -bottom-3 left-[15px] top-0 w-px bg-[var(--reader-thread-line)]" aria-hidden="true" />
                )}
                {/* Elbow down to this reply's avatar center (16px, plus the
                    pt-3 when there is one), across to its left edge. */}
                <span
                  className={`absolute left-[15px] top-0 rounded-bl-md border-b border-l border-[var(--reader-thread-line)] ${
                    isNewRootReply ? "h-7" : "h-4"
                  } ${depth === 2 ? "w-[30px] sm:w-[46px]" : "w-[14px] sm:w-[22px]"}`}
                  aria-hidden="true"
                />
                <div
                  ref={reply.id === focusReplyId ? focusRef : undefined}
                  className={
                    reply.id === focusReplyId
                      ? "-mx-2 rounded-sm bg-[color-mix(in_srgb,var(--reader-accent)_8%,transparent)] px-2"
                      : undefined
                  }
                >
                  <ReplyEntry reply={reply} replyingToName={replyingToName} depth={depth} ui={ui} actions={actions} />
                  {/* Same "mounts right under its own target" rule as the
                      root composer above — indented to this reply's own
                      depth so it visually hangs off the entry it addresses,
                      never a fixed slot shared by every other reply. mt-3:
                      this composer is a plain sibling of ReplyEntry inside a
                      non-flex wrapper, so it doesn't get the list's own
                      gap-3 between entries — without its own margin it sits
                      flush against the reaction/reply row above it. */}
                  {isReplyingToThis && (
                    <div className={`mt-3 ${depth === 2 ? "pl-4 sm:pl-6" : "pl-2 sm:pl-4"}`}>
                      <NoteComposer
                        initialText=""
                        placeholder={`Reply to ${reply.author.pseudonym}`}
                        showMemberPrompt
                        action="reply"
                        onCancel={() => ui.toggleComposer(reply.id)}
                        onSave={(content, visibility) => actions.reply(reply.id, content, visibility)}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {hiddenReplyCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllReplies(true)}
              className="flex items-center gap-1.5 pl-8 sm:pl-10 text-xs font-semibold text-[var(--reader-text-muted)] hover:text-[var(--reader-text)]"
            >
              <ChevronRight size={14} />
              Show {hiddenReplyCount} more {hiddenReplyCount === 1 ? "reply" : "replies"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
