"use client";

import { useState } from "react";
import { EllipsisVertical, Share, Trash2 } from "lucide-react";
import type { AnnotationRange } from "@/lib/api/types";
import { sameRanges } from "@/stores/library-store";
import { useSessionStore } from "@/stores/session-store";
import { useAnnotations } from "@/lib/reader/useAnnotations";
import { useDeleteHighlight } from "@/lib/materials/useHighlightMutations";
import { useCreateNote, useDeleteNote } from "@/lib/community/useNoteMutations";
import { quoteForRanges } from "@/lib/reader/annotationSelection";
import { topLevelNotes, repliesFor, sortNotes, type NoteSortMode } from "@/lib/reader/noteThread";
import { useThreadInteraction } from "@/lib/reader/useThreadInteraction";
import NoteThreadCard from "./notes/NoteThreadCard";
import NoteComposer from "./notes/NoteComposer";
import PanelShell from "./notes/PanelShell";
import HighlightCard from "./notes/HighlightCard";
// import SortToggle from "./notes/SortToggle";
import OverflowMenu from "./notes/OverflowMenu";
import { confirmAction, DELETE_ANNOTATION } from "@/stores/confirm-store";

type Props = {
  materialId: string;
  /** The passage this panel was opened from — one of possibly several the
   * annotation's ranges touch. */
  passageId: string;
  /** Resolves any passage's full plain text by id, so a cross-passage
   * annotation's quote can be assembled from more than one passage. */
  getPassageText: (passageId: string) => string;
  /** An existing annotation (thread) being viewed/added to. */
  annotationId?: string;
  /** A brand-new thread with no annotation yet — one range per passage the
   * just-made selection touched. */
  pendingRanges?: AnnotationRange[];
  /** Deep-links straight into editing one specific existing entry — absent,
   * the panel opens to the thread as normal. */
  editingNoteId?: string;
  /** When deep-linked from a notification, the specific thread (root note
   * id) whose replies should be fully expanded (show all). */
  targetThreadId?: string;
  panelType?: "side" | "sheet";
  onClose: () => void;
  /** Opens the share-image modal for this thread's quoted passage — Reader
   * owns the modal itself (it also has to know the book title/author, which
   * this panel never receives), so this just hands back the assembled
   * quote text. */
  onShare: (quote: string) => void;
};

function EditPanel({
  materialId,
  passageId,
  getPassageText,
  annotationId,
  pendingRanges,
  editingNoteId,
  targetThreadId,
  panelType,
  onClose,
  onShare,
}: Props) {
  const { annotationsByPassage } = useAnnotations(materialId);
  const annotations = annotationsByPassage[passageId] ?? [];
  const createNote = useCreateNote(materialId);
  const deleteNote = useDeleteNote(materialId);
  const deleteHighlight = useDeleteHighlight(materialId);
  const readerId = useSessionStore((s) => s.readerId);

  // A brand-new thread has no annotationId yet — after its first note is
  // saved, the server creates one, but this component only has the ranges
  // it asked for, so it re-finds "the annotation it just made" by those
  // same ranges rather than an id it was never given.
  const existing = annotationId
    ? annotations.find((a) => a.id === annotationId)
    : pendingRanges
    ? annotations.find((a) => sameRanges(a.ranges, pendingRanges))
    : undefined;
  const ranges = existing?.ranges ?? pendingRanges ?? [];
  const quoteText = quoteForRanges(ranges, getPassageText);

  // The whole thread, flat — every top-level note and every reply, two
  // tiers only (see Note.parentId). Which top-level notes show their
  // replies expanded is local UI state below, not part of this data.
  const allNotes = existing?.notes ?? [];
  const roots = topLevelNotes(allNotes);

  const [sortMode, setSortMode] = useState<NoteSortMode>("chronological");
  const [panelMenuOpen, setPanelMenuOpen] = useState(false);

  const { ui, actions, expandedIds, toggleExpanded } = useThreadInteraction({
    materialId,
    ranges,
    allNotes,
    initialEditingId: editingNoteId,
  });

  const handleDeleteAnnotation = async () => {
    if (!existing) return;
    // Destructive and irreversible, so the menu item asks first.
    const ok = await confirmAction({
      ...DELETE_ANNOTATION,
      title: roots.length > 0 ? "Delete this highlight and its notes?" : "Delete this highlight?",
    });
    if (!ok) return;
    if (existing.highlightId) deleteHighlight.mutate(existing.highlightId);
    // Own root notes only — same reasoning as useTextAnnotations'
    // deleteSelection: a co-located note from another reader is never
    // this action's to remove. Deleting every own top-level note already
    // cascades to its replies server-side (parent_id on delete cascade) —
    // no need to also walk the rest of allNotes here.
    for (const note of roots) {
      if (note.author.readerId === readerId) deleteNote.mutate(note.id);
    }
    onClose();
  };

  const sortedRoots = sortNotes(roots, sortMode);

  return (
    <PanelShell
      panelType={panelType}
      title=""
      onClose={onClose}
      footer={
        // Same bottom-docked composer as the book-wide feed panel
        // (FeedPanel) — pinned below the scrollable thread
        // regardless of scroll position, not part of the flowing content.
          <NoteComposer
            initialText=""
            placeholder="Share a note"
            showMemberPrompt
            action="note"
            draftKey={`highlight-${materialId}-${JSON.stringify(ranges)}`}
            onSave={(content, visibility) =>
              createNote.mutate(
                { ranges, content, visibility },
                { onError: () => ui.reportError("Couldn't save your note — check your connection and try again.") }
              )
            }
          />
      }
      headerMenu={
        existing ? (
          <div className="relative flex-none">
            <button
              onClick={() => setPanelMenuOpen((v) => !v)}
              className="flex items-center justify-center bg-transparent border-none cursor-pointer text-[var(--reader-text-muted)]"
            >
              <EllipsisVertical size={16} />
            </button>
            {panelMenuOpen && (
              <OverflowMenu
                onClose={() => setPanelMenuOpen(false)}
                items={[
                  {
                    label: "Share passage",
                    onClick: () => {
                      setPanelMenuOpen(false);
                      onShare(quoteText);
                    },
                    icon: <Share size={13} />,
                  },
                  {
                    label: "Delete highlight",
                    danger: true,
                    icon: <Trash2 size={13} />,
                    onClick: () => {
                      setPanelMenuOpen(false);
                      void handleDeleteAnnotation();
                    },
                  },
                ]}
              />
            )}
          </div>
        ) : undefined
      }
    >
      {/* Only shown here, above the thread list, when there's no note yet
          to attach it to (a fresh thread) — once a root note exists, its
          own NoteThreadCard renders this same quote itself, positioned
          after that note's AuthorRow rather than before it (see the
          `quote` prop passed below). Showing it in both places at once
          would repeat it once per root note. */}
      {sortedRoots.length === 0 && <HighlightCard text={quoteText} />}
      <>
          {/* {roots.length > 0 && <SortToggle mode={sortMode} onChange={setSortMode} />} */}

          {sortedRoots.length > 0 ? (
            <div className="flex flex-col gap-5">
              {sortedRoots.map((note) => (
                <NoteThreadCard
                  key={note.id}
                  quote={quoteText}
                  note={note}
                  replies={repliesFor(allNotes, note.id)}
                  expanded={expandedIds.has(note.id)}
                  initialShowAll={targetThreadId === note.id}
                  onToggleExpand={() => toggleExpanded(note.id)}
                  ui={ui}
                  actions={actions}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--reader-text-muted)] text-center py-1 m-0">
              {/* No notes yet */}
            </p>
          )}

          {ui.actionError && (
            <p className="m-0 text-[11px] text-[var(--reader-text-muted)]">{ui.actionError}</p>
          )}
      </>
    </PanelShell>
  );
}

/** Private highlights/notes UI for one annotation — opened from clicking an
 * existing mark's "Add note"/"View thread" action, or from a fresh
 * selection's Note action. */
export default function NotesSidebar(props: Props) {
  return <EditPanel {...props} />;
}
