"use client";

import type { ReactNode } from "react";
import { ROOM_CHAT_ID } from "./RoomActions";
import RoomAvatar from "./RoomAvatar";
import { RoomChatList } from "./RoomChat";
import UnreadBadge from "./UnreadBadge";
import { comradeName } from "@/lib/reader/authorDisplay";
import { formatShortTimeAgo } from "@/lib/reader/timeAgo";
import { positionLabel } from "@/lib/room/follow";
import { narratorName } from "@/lib/room/presence";
import { useFollowing, useHands, useListening, usePlace, useReaderView, useRoom, useSpeaking, useVoice } from "@/lib/room/hooks";
import type { RoomPresence } from "@/lib/room/events";
import { formatDuration } from "@/lib/time/duration";
import { useNow } from "@/lib/time/useNow";
import { useRoomStore } from "@/stores/room-store";

// The feed panel's Room tab, the expanded mini-player (design M6 / C5): Live
// with the count and the time, the room's title over its book, then
// Speakers, Hands raised, Listening and Chat on one page, each under its
// heading. The controls stay in the mini-player, which shows alongside;
// the chat's composer is the panel's footer (RoomChatComposer). A tap on a
// face follows (spec §1.6). Loaded by FeedPanel only while you're in the
// room on this book.

/** Who's here and the chat, the Room tab's body. */
export function RoomStage() {
  const session = useRoomStore((s) => s.session);
  const followingId = useFollowing()?.member.readerId;
  const room = useRoom((s) => s.room);
  const me = useRoom((s) => s.readerId);
  const count = useRoom((s) => s.roster.length) ?? 0;
  const unread = useRoom((s) => s.chat.unread) ?? 0;
  const speaking = useSpeaking() ?? [];
  const hands = useHands() ?? [];
  const listening = useListening() ?? [];
  const now = useNow();

  if (!room || !session) return null;
  const follow = (p: RoomPresence) => (p.readerId === me ? undefined : () => session.follow(p.readerId));
  const row = (p: RoomPresence) => ({
    member: p,
    pressed: p.readerId === followingId,
    onClick: follow(p),
  });

  return (
    <div className="flex flex-col gap-5 pt-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex flex-none items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--reader-accent)_12%,var(--reader-surface))] px-2 py-[3px] text-[10px] leading-[1.3] font-bold tracking-[0.08em] text-[var(--reader-accent)] uppercase">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            Live
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--reader-text-muted)]">
            {count} listening · {formatDuration(now - Date.parse(room.startedAt))}
          </span>
        </div>
        <h2 className="m-0 font-serif text-lg leading-tight font-semibold">{room.title}</h2>
        <p className="m-0 truncate text-[13px] font-medium text-[var(--reader-text-muted)]">
          {room.bookTitle}
          {room.bookAuthor && ` · ${room.bookAuthor}`}
        </p>
      </header>

      {speaking.length > 0 && (
        <Section title="Speakers" count={speaking.length}>
          {speaking.map((p) => (
            <Member key={p.readerId} {...row(p)} stage fallback="Mic on" />
          ))}
        </Section>
      )}

      {hands.length > 0 && (
        <Section title="Hands raised" count={hands.length}>
          {hands.map((p) => (
            <Member
              key={p.readerId}
              {...row(p)}
              fallback="Hand raised"
              after={formatShortTimeAgo(p.handRaisedAt!, now)}
            />
          ))}
        </Section>
      )}

      <Section title="Listening" count={listening.length}>
        {listening.length === 0 ? (
          <p className="m-0 text-[13px] text-[var(--reader-text-muted)]">Waiting for comrades</p>
        ) : (
          listening.map((p) => <Member key={p.readerId} {...row(p)} fallback="Listening" />)
        )}
      </Section>

      <Section id={ROOM_CHAT_ID} title="Chat" badge={<UnreadBadge count={unread} />}>
        <RoomChatList />
      </Section>
    </div>
  );
}

/** A heading over its rows: the title, how many, and any badge. */
function Section({
  id,
  title,
  count,
  badge,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-2">
      <div className="flex items-center gap-2 py-1">
        <h3 className="m-0 font-sans text-[13px] font-bold text-[var(--reader-text-muted)]">{title}</h3>
        {count !== undefined && (
          <span className="text-xs font-medium tabular-nums text-[var(--reader-text-subtle)]">{count}</span>
        )}
        <span className="flex-1" />
        {badge}
      </div>
      {children}
    </section>
  );
}

/** Someone in the room, the same row in every section: their face, their
 * name, and a line under it — "Speaking" while they talk, else where they
 * are ("p. 4", "Chapter 9"; spec §3.3) or `fallback`, after "Host" for a moderator and
 * before `after` (how long a hand's been up). Each is a bordered card;
 * speakers sit on the stage with a larger face. */
function Member({
  member,
  pressed,
  onClick,
  stage = false,
  fallback,
  after,
}: {
  member: RoomPresence;
  pressed: boolean;
  onClick: (() => void) | undefined;
  stage?: boolean;
  fallback: string;
  after?: string;
}) {
  const { speaking } = useVoice(member.readerId);
  const place = usePlace(member.readerId);
  const view = useReaderView();
  const narrator = narratorName(member);
  const status = narrator
    ? `${narrator} narrating`
    : speaking
      ? "Speaking"
      : (positionLabel(member, place, view)?.text ?? fallback);
  const line = [member.isModerator && "Host", status, after].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3 rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] py-2.5 pr-2 pl-3">
      <RoomAvatar member={member} size={stage ? 44 : 40} pressed={pressed} onClick={onClick} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] text-[var(--reader-text)] font-semibold">{comradeName(member.name)}</span>
        <span
          className={`truncate text-xs ${
            speaking || narrator ? "font-bold text-[var(--reader-accent)]" : "font-medium text-[var(--reader-text-muted)]"
          }`}
        >
          {line}
        </span>
      </div>
    </div>
  );
}
