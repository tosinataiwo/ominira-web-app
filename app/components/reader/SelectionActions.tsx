"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Copy, Headphones, Highlighter, MessageCircle, MessageSquareQuote, Share, Trash2 } from "lucide-react";
import { useDockedHeight } from "@/app/components/useBottomDock";
import { quoteForRanges } from "@/lib/reader/annotationSelection";
import type { SelectionOverlay, SelectionState } from "@/lib/reader/useTextAnnotations";
import { useShareToRoom } from "@/lib/room/sharePassage";
import { useReaderStore } from "@/stores/reader-store";
import MembersOnlyPrompt from "./notes/MembersOnlyPrompt";
import SelectionMenu, { type Item } from "./SelectionMenu";
import ShareQuoteModal from "./ShareQuoteModal";
import { confirmAction, DELETE_ANNOTATION } from "@/stores/confirm-store";

const NARROW_QUERY = "(max-width: 859px)";
/** The phone/desktop split every reader uses (useSectionCarousel's 860px) —
 * picks the bottom-bar menu and the bottom-sheet notes panel. */
export function useNarrowViewport() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(NARROW_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false
  );
}

/** The quote card, for the selection menu's Share and the notes panel's —
 * `share(quote)` opens it; render `modal` once anywhere (it's fixed). */
export function useShareQuote(title: string, author?: string): { share: (quote: string) => void; modal: ReactNode } {
  const [quote, setQuote] = useState<string | null>(null);
  return {
    share: setQuote,
    modal:
      quote !== null ? (
        <div className="fixed inset-0 z-[80]">
          <ShareQuoteModal quote={quote} author={author} bookTitle={title} onClose={() => setQuote(null)} />
        </div>
      ) : null,
  };
}

/**
 * The selection menu for every reader (EPUB, PDF, DOCX, web article) — the
 * one place its actions are defined: Highlight, Note, Copy, Listen, Share,
 * Share to room, Delete. Also the signed-out / couldn't-save prompts that
 * replace it in place.
 *
 * Listen shows only when the reader passes `onListenFrom`; Share to room only
 * while the reader is in this material's room; Delete only on an existing mark.
 */
export default function SelectionActions({
  materialId,
  selection,
  overlay,
  getPassageText,
  locationLabel,
  hasExistingAnnotation,
  onHighlight,
  onNote,
  onDelete,
  onDismiss,
  onDismissOverlay,
  onListenFrom,
  onShare,
  onSharedToRoom,
}: {
  materialId: string;
  selection: SelectionState | null;
  overlay: SelectionOverlay | null;
  getPassageText: (passageId: string) => string;
  /** The label a passage shared to the room carries (chapter, page…). */
  locationLabel: (passageId: string) => string;
  hasExistingAnnotation: boolean;
  onHighlight: () => void;
  onNote: () => void;
  onDelete: () => void;
  onDismiss: () => void;
  onDismissOverlay: () => void;
  /** Narration from the selection's first word: its passage and offset. */
  onListenFrom?: (passageId: string, offset: number) => void;
  /** Opens the quote card (useShareQuote's `share`). */
  onShare: (quote: string) => void;
  /** After a share to the room — the reader opens its room feed. */
  onSharedToRoom: () => void;
}) {
  // The mobile bar sits above the narration bar / room player.
  const dockedHeight = useDockedHeight();
  const theme = useReaderStore((s) => s.theme);
  const isMobile = useNarrowViewport();
  const shareToRoom = useShareToRoom(materialId);
  const [copied, setCopied] = useState(false);

  const iconSize = isMobile ? 18 : 14;
  const items = (): Item[] => {
    if (!selection) return [];
    const { ranges } = selection;
    const quote = () => quoteForRanges(ranges, getPassageText);
    return [
      { key: "highlight", icon: <Highlighter size={iconSize} />, label: "Highlight", onClick: onHighlight },
      { key: "note", icon: <MessageCircle size={iconSize} />, label: "Note", onClick: onNote },
      {
        key: "copy",
        icon: <Copy size={iconSize} />,
        label: copied ? "Copied ✓" : "Copy",
        onClick: () =>
          void navigator.clipboard.writeText(quote()).then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
              onDismiss();
            }, 800);
          }),
      },
      ...(onListenFrom
        ? [
            {
              key: "listen",
              icon: <Headphones size={iconSize} />,
              label: "Listen",
              onClick: () => {
                onListenFrom(ranges[0].passageId, ranges[0].start);
                onDismiss();
              },
            },
          ]
        : []),
      {
        key: "share",
        icon: <Share size={iconSize} />,
        label: "Share",
        onClick: () => {
          onShare(quote());
          onDismiss();
        },
      },
      ...(shareToRoom
        ? [
            {
              key: "room",
              icon: <MessageSquareQuote size={iconSize} />,
              label: "Share to room",
              onClick: () => {
                shareToRoom({ ranges, quote: quote(), label: locationLabel(ranges[0].passageId) });
                onSharedToRoom();
                onDismiss();
              },
            },
          ]
        : []),
      ...(hasExistingAnnotation
        ? [{ key: "delete", icon: <Trash2 size={iconSize} />, label: "Delete", onClick: async () => {
          if (await confirmAction(DELETE_ANNOTATION)) onDelete();
        }, danger: true }]
        : []),
    ];
  };

  return (
    <>
      {selection && (
        <SelectionMenu
          anchor={selection.anchor}
          isMobile={isMobile}
          bottomOffsetPx={dockedHeight}
          theme={theme}
          items={items()}
          onDismiss={onDismiss}
        />
      )}
      {/* Replaces the menu in place — a signed-out highlight attempt (stays up
          until dismissed) or a failed save (self-clears). Never both at once:
          highlighting/deleting clears the selection before setting this. */}
      {overlay && (
        <SelectionMenu
          anchor={overlay.anchor}
          isMobile={isMobile}
          bottomOffsetPx={dockedHeight}
          theme={theme}
          items={[]}
          override={
            overlay.kind === "auth" ? (
              <MembersOnlyPrompt action="highlight" onClose={onDismissOverlay} />
            ) : (
              <div className="rounded-sm border border-[var(--reader-border)] bg-[var(--reader-surface)] p-3.5">
                <p className="m-0 text-[13px] font-medium leading-relaxed text-[var(--reader-text-muted)]">
                  Couldn&rsquo;t save — check your connection and try again.
                </p>
              </div>
            )
          }
          onDismiss={onDismissOverlay}
        />
      )}
    </>
  );
}
