"use client";

import { Loader2, Mic, MicOff } from "lucide-react";
import { useRoomControls } from "@/lib/room/hooks";
import { useRoomStore } from "@/stores/room-store";

// Your mic, in the mini-player (labelled) and the panel footer (round)
// (spec §1.2): outline + mic-off when off, brand fill + mic when on, a
// spinner while the browser asks, and "Mic blocked" when it was refused
// (tapping asks again).

export default function MicToggle({ className, round = false }: { className: string; round?: boolean }) {
  const session = useRoomStore((s) => s.session);
  const controls = useRoomControls();
  if (!controls || !session) return null;
  const { micOn, micState, connection } = controls;
  const acquiring = micState === "acquiring";
  const blocked = micState === "blocked" && !micOn;
  const label = acquiring ? "Turning on…" : blocked ? "Mic blocked" : micOn ? "Mic on" : "Turn on mic";
  const Icon = acquiring ? Loader2 : micOn ? Mic : MicOff;

  return (
    <button
      type="button"
      disabled={connection === "connecting" || acquiring}
      aria-pressed={micOn}
      aria-label={round ? (micOn ? "Turn off your mic" : blocked ? "Mic blocked, try again" : "Turn on your mic") : undefined}
      title={round ? label : undefined}
      onClick={() => void session.setMic(!micOn)}
      className={`${className} ${
        micOn
          ? "border-brand-500 bg-brand-500 text-white"
          : blocked
            ? "border-[var(--reader-border)] bg-transparent text-[var(--reader-text-muted)]"
            : "border-[var(--reader-accent)] bg-transparent text-[var(--reader-accent)]"
      }`}
    >
      <Icon size={18} strokeWidth={1.75} className={acquiring ? "animate-spin" : undefined} />
      {!round && label}
    </button>
  );
}
