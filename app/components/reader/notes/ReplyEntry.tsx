"use client";

import { EllipsisVertical } from "lucide-react";
import Link from "next/link";
import type { Note } from "@/lib/api/types";
import { useIsOwnNote } from "@/lib/reader/currentAuthor";
import { comradeName } from "@/lib/reader/authorDisplay";
import { pseudonymToSlug } from "@/lib/reader/profileSlug";
import AuthorAvatar from "./AuthorAvatar";
import AuthorRow from "./AuthorRow";
import NoteContent from "./NoteContent";
import ReactionButton from "./ReactionButton";
import NoteComposer from "./NoteComposer";
import EntryMenu from "./EntryMenu";
import type { ThreadActions, ThreadUIState } from "@/lib/reader/threadTypes";

/** One reply, at the flat second tier under its top-level note — same
 * author/content/action shape as NoteThreadCard, just smaller, plus the
 * "replying to Comrade X" chip when it addresses another reply rather than
 * the top-level note itself (see NoteEntry.replyingToId).
 *
 * Its own "Reply" trigger doesn't mount a composer here — NoteThreadCard
 * owns the one shared composer instance for the whole thread; this button
 * only retargets it (`ui.toggleComposer`), marked with
 * `data-note-reply-trigger` so that composer's outside-click handling
 * never mistakes clicking it for dismissal. */
export default function ReplyEntry({
  reply,
  replyingToName,
  depth = 1,
  ui,
  actions,
}: {
  reply: Note;
  replyingToName?: string;
  /** 2 for a reply that itself addresses another reply (nested one step
   * further under the vertical thread rule) rather than the top-level
   * note — same distinction `replyingToName` already carries, just as an
   * indent level for the rule/padding below. */
  depth?: 1 | 2;
  ui: ThreadUIState;
  actions: ThreadActions;
}) {
  const own = useIsOwnNote(reply);
  const isEditing = ui.editingId === reply.id;
  const isTargeted = ui.activeComposerFor === reply.id;
  const isMenuOpen = ui.activeMenuFor === reply.id;

  return (
    // min-w-0: see the identical comment on NoteThreadCard's own content
    // column — this is a flex item of NoteThreadCard's reply-list column,
    // and without it a long unbroken run inside NoteContent (a URL) sets
    // this reply's own minimum width to that run's full length rather than
    // letting NoteContent's wrap utilities engage. No tree lines of its own —
    // NoteThreadCard draws the trunk and elbows; a depth-2 reply (addressing
    // another reply, not the root) just gets a little extra indent here,
    // which that elbow reaches into, rather than a second nested trunk.
    <div className={`flex min-w-0 flex-col gap-1.5 ${depth === 2 ? "pl-4 sm:pl-6" : ""}`}>
      {/* Same avatar-beside-just-the-name-row pairing as NoteThreadCard's
          own root layout — a reply's author gets the same identity
          treatment as a top-level note's, not a scaled-down one. */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <AuthorAvatar author={reply.author} />
        <div className="min-w-0 flex-1">
          <AuthorRow
            name={reply.author.pseudonym}
            savedAt={Date.parse(reply.createdAt)}
            city={reply.author.city}
            isPrivate={own && reply.visibility === "private"}
            menu={
              own ? (
                // self-center: see the identical comment on NoteThreadCard's
                // own menu button — keeps this non-text child out of
                // AuthorRow's own baseline alignment, so it can't inflate
                // the row taller than AuthorAvatar beside it.
                <div className="relative ml-auto flex-none self-center">
                  <button
                    onClick={() => ui.toggleMenu(isMenuOpen ? null : reply.id)}
                    className="flex items-center bg-transparent border-none cursor-pointer text-[var(--reader-text-muted)] p-0.5"
                  >
                    <EllipsisVertical size={15} />
                  </button>
                  {isMenuOpen && (
                    <EntryMenu
                      isOwn={own}
                      isTextEntry={reply.content.kind === "text"}
                      onEdit={() => {
                        ui.startEdit(reply.id);
                        ui.toggleMenu(null);
                      }}
                      onDelete={() => {
                        actions.delete(reply.id);
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
          above sits beside it, same as NoteThreadCard's own root layout. */}
      <div className="flex min-w-0 flex-col gap-1.5">
        {replyingToName && (
          <div className="w-fit font-serif italic text-[11px] text-[var(--reader-text-muted)]">
            — in reply to{" "}
            <Link href={`/@${pseudonymToSlug(replyingToName)}`} className="text-[var(--reader-text-muted)] hover:underline">
              {comradeName(replyingToName)}
            </Link>
          </div>
        )}
        {isEditing ? (
          <NoteComposer
            initialText={reply.content.kind === "text" ? reply.content.text : ""}
            initialVisibility={reply.visibility}
            onCancel={() => ui.startEdit(null)}
            onSave={(content, visibility) => {
              actions.saveEdit(reply.id, content, visibility);
              ui.startEdit(null);
            }}
          />
        ) : (
          <NoteContent content={reply.content} />
        )}
        <div className="flex items-center gap-3.5">
          <ReactionButton
            count={reply.reactionCount}
            reacted={reply.reactedByMe}
            onToggle={() => actions.toggleReaction(reply.id)}
            size="small"
          />
          <button
            data-note-reply-trigger
            onClick={() => ui.toggleComposer(reply.id)}
            className={`border-[var(--reader-border)] bg-[var(--reader-surface)] cursor-pointer text-xs font-semibold p-0 ${
              isTargeted ? "text-[var(--reader-text)]" : "text-[var(--reader-text-muted)]"
            }`}
          >
            Reply
          </button>
        </div>
      </div>
    </div>
  );
}
