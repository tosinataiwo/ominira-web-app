"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import RoomAvatar from "./RoomAvatar";
import { comradeName } from "@/lib/reader/authorDisplay";
import { useFollowing } from "@/lib/room/hooks";
import { useRoomStore } from "@/stores/room-store";

// Above the mini-player while you're in the book's reader (spec §3, M3/M4):
// "Reading along with Ada" (never "Following" — that reads as a profile
// follow), or after a scroll of your own, solid "Return to Ada"
// with an arrow towards her; × stops. A moderator's Bring everyone to my
// page makes everyone follow them (spec §9).

const pill = "pointer-events-auto flex h-9 max-w-full items-center rounded-full text-sm font-bold shadow-sm";
const close = "flex h-9 w-9 flex-none cursor-pointer items-center justify-center rounded-full";

export default function FollowPill() {
  const following = useFollowing();
  const session = useRoomStore((s) => s.session);
  if (!following || !session) return null;
  const name = comradeName(following.member.name);
  const Arrow = following.direction === "up" ? ArrowUp : ArrowDown;

  if (following.paused) {
    return (
      <div className={`${pill} bg-brand-500 text-white`}>
        <button
          type="button"
          onClick={() => session.returnToFollowed()}
          className="flex h-9 min-w-0 cursor-pointer items-center gap-1.5 pr-1 pl-3.5"
        >
          <Arrow size={16} strokeWidth={2.25} className="flex-none" />
          <span className="truncate">Return to {name}</span>
        </button>
        <button type="button" aria-label={`Stop reading along with ${name}`} onClick={() => session.unfollow()} className={`${close} hover:bg-white/15`}>
          <X size={16} strokeWidth={2.25} />
        </button>
      </div>
    );
  }

  return (
    <div className={`${pill} border border-brand-300 bg-[var(--reader-surface)] pl-1.5 text-[var(--reader-text)]`}>
      <RoomAvatar member={following.member} size={24} />
      <span className="truncate pl-2">Reading along with {name}</span>
      <button
        type="button"
        aria-label={`Stop reading along with ${name}`}
        onClick={() => session.unfollow()}
        className={`${close} text-[var(--reader-text-muted)] hover:text-[var(--reader-text)]`}
      >
        <X size={16} strokeWidth={2.25} />
      </button>
    </div>
  );
}
