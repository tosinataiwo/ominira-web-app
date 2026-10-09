"use client";

import { Loader2, Mic, MicOff } from "lucide-react";
import { useRoomControls } from "@/lib/room/hooks";
import { useRoomStore } from "@/stores/room-store";
import { tapNarration } from "@/lib/audio/narrationTap";
import { voiceById } from "@/lib/audio/voices";
import { useAudioStore } from "@/stores/audio-store";

// Your mic, labelled, in RoomActions (spec §1.2): outline + mic-off when off, brand fill + mic when on, a
// spinner while the browser asks, and "Mic blocked" when it was refused
// (tapping asks again). "Leah narrating" while your narration is what the room
// hears (RoomNarration): playing it with the mic on sends the narrator's voice
// in place of yours.

/** `iconOnly`: just the icon (the minimised mini-player), the label moving
 * to aria-label/title. */
export default function MicToggle({ className, iconOnly = false }: { className: string; iconOnly?: boolean }) {
  const session = useRoomStore((s) => s.session);
  const controls = useRoomControls();
  const narrator = useAudioStore((s) => voiceById(s.voice)?.name ?? "Narrator");
  if (!controls || !session) return null;
  const { micOn, micState, readingAloud, connection } = controls;
  const acquiring = micState === "acquiring";
  const blocked = micState === "blocked" && !micOn;
  const label = acquiring
    ? "Turning on…"
    : blocked
      ? "Mic blocked"
      : readingAloud
        ? `${narrator} narrating`
        : micOn
          ? "Mic on"
          : "Turn on mic";
  const Icon = acquiring ? Loader2 : micOn ? Mic : MicOff;

  return (
    <button
      type="button"
      disabled={connection === "connecting" || acquiring}
      aria-pressed={micOn}
      {...(iconOnly ? { "aria-label": label, title: label } : {})}
      onClick={() => {
        // In this tap, so the browser lets the narration's audio graph start.
        if (!micOn) tapNarration();
        void session.setMic(!micOn);
      }}
      className={`${className} ${
        micOn
          ? "border-brand-500 bg-brand-500 text-white"
          : blocked
            ? "border-[var(--reader-border)] bg-transparent text-[var(--reader-text-muted)]"
            : "border-[var(--reader-accent)] bg-transparent text-[var(--reader-accent)]"
      }`}
    >
      <Icon size={18} strokeWidth={1.75} className={acquiring ? "animate-spin" : undefined} />
      {!iconOnly && label}
    </button>
  );
}
