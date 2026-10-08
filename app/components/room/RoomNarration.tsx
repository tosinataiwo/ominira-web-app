"use client";

import { useEffect } from "react";
import { useAudioStore } from "@/stores/audio-store";
import { useNarrationStore } from "@/stores/narration-store";
import { useRoomStore } from "@/stores/room-store";
import { narrationTrack } from "@/lib/audio/narrationTap";

/**
 * Hands the session your narration while it plays the room's book: with your
 * mic on, listeners hear it in place of your voice and follow its word
 * (session.setNarration). Pausing it gives the room your voice back.
 */
export default function RoomNarration() {
  const session = useRoomStore((s) => s.session);
  const roomMaterialId = useRoomStore((s) => s.snapshot?.room.materialId);
  const playing = useAudioStore((s) => s.isPlaying && s.book !== null && s.materialId === roomMaterialId);
  const word = useNarrationStore((s) => s.currentWord);
  const voice = useAudioStore((s) => s.voice);

  // Kept through the gap while the next passage loads, so the mic doesn't
  // cut in between passages.
  const track = playing ? narrationTrack() : null;

  useEffect(() => {
    if (!session) return;
    session.setNarration(track ? { track, voice, word } : null);
  }, [session, track, voice, word]);
  useEffect(() => () => session?.setNarration(null), [session]);
  return null;
}
