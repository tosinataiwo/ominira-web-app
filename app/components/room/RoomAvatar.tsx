"use client";

import { Hand } from "lucide-react";
import ReaderAvatar from "@/app/components/shared/ReaderAvatar";
import { LiveBadge } from "@/app/components/reader/ReaderPresence";
import { comradeName } from "@/lib/reader/authorDisplay";
import type { RoomPresence } from "@/lib/room/events";
import { useVoice } from "@/lib/room/hooks";

// A room member's face (spec §4 sheet 04): the reader's own avatar plus what
// they're doing in the room. Built on ReaderAvatar rather than AuthorAvatar,
// since a tap here follows (spec §1.6) instead of opening the profile.
// Speaking (detected) and connecting (their audio link is down, spec §10's
// speaker dropped) come from the room, per member.

type Props = {
  member: Pick<RoomPresence, "readerId" | "name" | "avatar" | "micOnAt" | "handRaisedAt" | "mode">;
  size?: number;
  /** Placed by progress rather than an exact position. */
  approximate?: boolean;
  /** A tap follows them (spec §1.6). */
  onClick?: () => void;
  /** You follow them: the tap stops. */
  pressed?: boolean;
};

export function roomAvatarLabel({
  member,
  speaking,
  connecting,
}: Pick<Props, "member"> & { speaking: boolean; connecting: boolean }) {
  const state = connecting
    ? "connecting"
    : speaking
      ? "speaking"
      : member.micOnAt !== null
        ? "mic on"
        : member.handRaisedAt !== null
          ? "hand raised"
          : member.mode === "listen"
            ? "listening"
            : null;
  const name = comradeName(member.name);
  return state ? `${name}, ${state}` : name;
}

export default function RoomAvatar({ member, size = 32, approximate, onClick, pressed }: Props) {
  const { speaking, connecting } = useVoice(member.readerId);
  const micOn = member.micOnAt !== null;
  // Speaking: brand ring; mic on but quiet: a thin pale one (design "stage").
  const ring = speaking
    ? `0 0 0 2px var(--reader-surface), 0 0 0 ${size >= 40 ? 4.5 : 3.5}px var(--color-brand-500)`
    : micOn
      ? "0 0 0 1.5px var(--reader-surface), 0 0 0 3px var(--color-brand-200)"
      : "none";
  const badge = Math.max(12, Math.round(size * 0.42));
  const label = roomAvatarLabel({ member, speaking, connecting });
  const Wrapper = onClick ? "button" : "span";

  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick, "aria-pressed": pressed ?? false } : {})}
      aria-label={onClick ? `Follow ${label}` : label}
      title={onClick ? (pressed ? `Stop following ${comradeName(member.name)}` : `Follow ${comradeName(member.name)}`) : label}
      style={{ width: size, height: size }}
      className={`relative inline-flex flex-none rounded-full ${onClick ? "cursor-pointer" : ""}`}
    >
      <ReaderAvatar
        pseudonym={member.name}
        avatar={member.avatar}
        size={size}
        className="transition-[box-shadow,opacity] duration-150"
        style={{
          boxShadow: ring,
          opacity: connecting ? 0.55 : approximate ? 0.6 : 1,
          outline: connecting
            ? "2px dashed var(--color-brand-400)"
            : approximate
              ? "1.5px dashed var(--color-sand-400)"
              : "none",
          outlineOffset: connecting ? 2 : 1,
        }}
      />
      {member.handRaisedAt !== null ? (
        <span
          aria-hidden="true"
          style={{ width: badge, height: badge }}
          className="absolute -bottom-[3px] -right-[3px] flex items-center justify-center rounded-full border border-brand-300 bg-[var(--reader-surface)] text-brand-500 ring-[1.5px] ring-[var(--reader-surface)]"
        >
          <Hand size={Math.round(badge * 0.68)} strokeWidth={2.25} />
        </span>
      ) : (
        member.mode === "listen" && <LiveBadge live="listen" className="absolute -bottom-[3px] -right-[3px]" />
      )}
    </Wrapper>
  );
}
