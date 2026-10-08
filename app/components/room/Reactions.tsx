"use client";

import { useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import { comradeName } from "@/lib/reader/authorDisplay";
import { ROOM_REACTIONS } from "@/lib/room/events";
import { useRoom } from "@/lib/room/hooks";
import { useRoomStore } from "@/stores/room-store";

// Reactions in the mini-player (spec §1.5, §4 sheet 02):
// React opens the tray of seven over its row (RoomActions), 44px targets
// that narrow to fit, and it stays open for more taps until you tap away or
// press Escape. What's sent rises over the player with the reactor's name
// (reactions.ts); the chat gets the digest.

export function ReactButton({ className, disabled }: { className: string; disabled: boolean }) {
  const session = useRoomStore((s) => s.session);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="flex">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-label="React"
        title="React"
        onClick={() => setOpen(!open)}
        className={`${className} ${
          open
            ? "border-[var(--reader-accent)] text-[var(--reader-accent)]"
            : "border-[var(--reader-border)] text-[var(--reader-text)]"
        } bg-[var(--reader-surface)]`}
      >
        <SmilePlus size={18} strokeWidth={1.75} />
      </button>
      {open && (
        <div
          role="toolbar"
          aria-label="Reactions"
          className={`reader-menu-in absolute inset-x-0 bottom-full mx-auto w-fit max-w-full z-10 mb-2 flex rounded-full border border-[var(--reader-border)] bg-[var(--reader-surface)] p-1 shadow-md`}
        >
          {ROOM_REACTIONS.map(({ emoji, label }) => (
            <button
              key={emoji}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => session?.react(emoji)}
              className={`flex h-11 w-11 min-w-0 shrink cursor-pointer items-center justify-center rounded-full text-[22px] transition-transform hover:bg-[var(--reader-surface-hover)] active:scale-90`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Reactions rising over the player: name + emoji, ~3 s each. Visual only;
 * the chat's digest says it in words. */
export function RisingReactions() {
  const rising = useRoom((s) => s.rising);
  const people = useRoom((s) => s.chat.people);
  if (!rising?.length) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute right-4 bottom-full mb-2 flex flex-col items-end gap-1">
      {rising.map((r) => (
        <span
          key={r.id}
          style={{ animationDelay: `${r.delayMs}ms` }}
          className="room-rise flex items-center gap-1.5 rounded-full border border-[var(--reader-border)] bg-[var(--reader-surface)] py-0.5 pr-2.5 pl-1.5 text-xs font-semibold whitespace-nowrap text-[var(--reader-text)] shadow-sm"
        >
          <span className="text-lg leading-none">{r.emoji}</span>
          {comradeName(people?.[r.readerId]?.name ?? "comrade")}
        </span>
      ))}
    </div>
  );
}
