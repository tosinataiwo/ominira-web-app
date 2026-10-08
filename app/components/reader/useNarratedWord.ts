"use client";

import { useAudioStore } from "@/stores/audio-store";
import { useNarrationStore } from "@/stores/narration-store";
import { activeRoom, useRoomStore } from "@/stores/room-store";

export type NarratedWord = { passageId: string; index: number };

/**
 * The word being read aloud in this material, for every reader's word
 * highlight: your own narration's while it's this material, else the one a
 * speaker in this material's live room is reading to it. Null when neither.
 * Re-renders with each playback tick or room word, so call it from the
 * component that draws the mark, not a whole reader.
 */
export function useNarratedWord(materialId: string | undefined): NarratedWord | null {
  const local = useAudioStore((s) => s.book !== null && s.materialId === materialId);
  const localWord = useNarrationStore((s) => (local ? s.currentWord : null));
  const room = useRoomStore((s) => {
    const snapshot = activeRoom(s);
    return snapshot && snapshot.room.materialId === materialId ? snapshot.narration : null;
  });

  if (local) return localWord;
  return room ? { passageId: room.passageId, index: room.index } : null;
}
