"use client";

import type { AnnotationRange } from "@/lib/api/types";
import { useCreateNote } from "@/lib/community/useNoteMutations";
import { roomChatUnread, useRoomStore } from "@/stores/room-store";

// Share passage (spec §1.4, §3.2): from the reader's selection menu, the
// passage goes to the room chat's composer; sending it saves a normal public
// note on the passage, through the notes' own create path (useCreateNote),
// then posts its quote card to the chat ("Saved as a note"). Nothing about
// the note is room-specific (group rooms add `group_id` in Phase 5).

/** A selection waiting in the chat composer. */
export type PendingPassage = { ranges: AnnotationRange[]; quote: string; label: string };

/** The selection menu's Share to room: null unless you're in the room on this book. */
export function useShareToRoom(materialId: string): ((passage: PendingPassage) => void) | null {
  const inRoom = useRoomStore((s) => roomChatUnread(s, materialId) !== null);
  const attach = useRoomStore((s) => s.attachPassage);
  return inRoom ? attach : null;
}

/** Sends a shared passage with your words: `wait` within 2 s of your last
 * message (checked before the note is saved), `failed` when the note
 * couldn't be saved, so nothing was posted. */
export function useSendPassage(materialId: string) {
  const createNote = useCreateNote(materialId);
  return async (passage: PendingPassage, text: string): Promise<"sent" | "wait" | "failed"> => {
    const session = useRoomStore.getState().session;
    if (!session?.chatReady()) return "wait";
    try {
      await createNote.mutateAsync({ ranges: passage.ranges, content: { kind: "text", text: text.trim() }, visibility: "public" });
    } catch {
      return "failed";
    }
    return session.sendChat(text, passage) ? "sent" : "wait";
  };
}
