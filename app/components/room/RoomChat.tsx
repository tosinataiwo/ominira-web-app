"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SendHorizontal, X } from "lucide-react";
import ReaderAvatar from "@/app/components/shared/ReaderAvatar";
import QuoteCard from "@/app/components/reader/notes/QuoteCard";
import { comradeName } from "@/lib/reader/authorDisplay";
import { formatShortTimeAgo } from "@/lib/reader/timeAgo";
import { useRoom } from "@/lib/room/hooks";
import type { ChatItem, ChatPerson } from "@/lib/room/chat";
import { MAX_CHAT_LENGTH } from "@/lib/room/events";
import { useSendPassage } from "@/lib/room/sharePassage";
import { useNow } from "@/lib/time/useNow";
import { useRoomStore } from "@/stores/room-store";

// The Room chat tab of the notes rail (spec §1.4, §3.2), desktop rail and
// mobile notes panel alike: the notice first, then messages, shared passages
// and reaction digests as they come, and the composer in the panel's footer.
// Loaded by BookAnnotationFeedPanel only while you're in the room on this book.

/** Within this of the bottom, a new message keeps the list at the bottom. */
const PINNED_PX = 80;

export function RoomChatList() {
  const chat = useRoom((s) => s.chat);
  const me = useRoom((s) => s.readerId);
  const session = useRoomStore((s) => s.session);
  const now = useNow(30_000);
  const endRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const count = chat?.items.length ?? 0;

  // On screen: nothing is unread.
  useEffect(() => {
    session?.setChatViewing(true);
    return () => session?.setChatViewing(false);
  }, [session]);

  useEffect(() => {
    const scroller = endRef.current?.closest<HTMLElement>(".om-scroll");
    if (!scroller) return;
    const onScroll = () => {
      pinned.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < PINNED_PX;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const scroller = endRef.current?.closest<HTMLElement>(".om-scroll");
    if (scroller && pinned.current) scroller.scrollTop = scroller.scrollHeight;
  }, [count]);

  if (!chat) return null;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <p className="m-0 rounded-sm bg-[var(--reader-surface-hover)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[var(--reader-text-muted)]">
        Chat and reactions clear when the room ends. To keep something, save it as a note.
      </p>
      {chat.items.length === 0 ? (
        <p className="m-0 py-6 text-center text-[13px] text-[var(--reader-text-muted)]">
          Nothing said yet. Say hello to the room.
        </p>
      ) : (
        chat.items.map((item) =>
          item.kind === "digest" ? (
            <Digest key={item.id} item={item} />
          ) : (
            <Message key={item.id} item={item} person={chat.people[item.readerId]} mine={item.readerId === me} now={now} />
          ),
        )
      )}
      <div ref={endRef} />
    </div>
  );
}

function Message({
  item,
  person,
  mine,
  now,
}: {
  item: Extract<ChatItem, { kind: "message" }>;
  person: ChatPerson | undefined;
  mine: boolean;
  now: number;
}) {
  const name = person ? comradeName(person.name) : "A comrade";
  return (
    <div className="flex gap-2.5">
      <ReaderAvatar pseudonym={person?.name ?? "comrade"} avatar={person?.avatar ?? null} size={28} className="flex-none" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline gap-1.5 text-[12px]">
          <span className="truncate font-semibold text-[var(--reader-text)]">
            {name}
            {mine && <span className="font-normal text-[var(--reader-text-muted)]"> (you)</span>}
          </span>
          <span className="flex-none text-[var(--reader-text-subtle)]">{formatShortTimeAgo(item.at, now)}</span>
        </span>
        {item.passage && (
          <QuoteCard>
            <p className="m-0 font-serif text-[14px] leading-[1.7] text-[var(--color-app-text)]">{item.passage.quote}</p>
            <span className="flex justify-between gap-3 pt-1 pb-2 text-[11px] font-semibold text-[var(--reader-text-subtle)]">
              <span className="min-w-0 truncate">Shared passage{item.passage.label && ` · ${item.passage.label}`}</span>
              <span className="flex-none">Saved as a note</span>
            </span>
          </QuoteCard>
        )}
        <p className="m-0 text-[14px] leading-snug break-words whitespace-pre-wrap text-[var(--reader-text)]">{item.text}</p>
      </div>
    </div>
  );
}

function Digest({ item }: { item: Extract<ChatItem, { kind: "digest" }> }) {
  return (
    <p className="m-0 flex items-center justify-center gap-1.5 text-center text-[12px] font-semibold text-[var(--reader-text-muted)]">
      <span aria-hidden="true">{item.emojis.join(" ")}</span>
      {item.text}
    </p>
  );
}

/** "Message the room" + send, in the panel's footer. Enter sends, Shift+Enter
 * starts a new line. Within 2 s of your last message, it's kept and the
 * rate is explained. A passage shared from the reader waits above the box,
 * and your words go with it: saved as a note, then posted (sharePassage.ts). */
export function RoomChatComposer({ materialId }: { materialId: string }) {
  const session = useRoomStore((s) => s.session);
  const passage = useRoomStore((s) => s.passage);
  const clearPassage = useRoomStore((s) => s.clearPassage);
  const sendPassage = useSendPassage(materialId);
  const connecting = useRoom((s) => s.connection === "connecting");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  // A passage just arrived: write about it.
  useEffect(() => {
    if (passage) inputRef.current?.focus();
  }, [passage]);

  const send = async () => {
    if (!session || !text.trim() || saving) return;
    if (!passage) {
      if (session.sendChat(text)) setText("");
      else setNotice(SLOW);
      return;
    }
    setSaving(true);
    const result = await sendPassage(passage, text);
    setSaving(false);
    if (result === "sent") {
      setText("");
      clearPassage();
    } else {
      setNotice(result === "wait" ? SLOW : "Couldn't save it as a note. Check your connection and try again.");
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {passage && (
        <div className="flex items-start gap-2 rounded-sm border border-[var(--reader-border)] bg-[var(--color-app-surface-muted)] py-2 pr-1.5 pl-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[11px] font-semibold text-[var(--reader-text-subtle)]">
              Sharing passage{passage.label && ` · ${passage.label}`}
            </span>
            <p className="m-0 line-clamp-2 font-serif text-[13px] leading-snug text-[var(--color-app-text)]">{passage.quote}</p>
          </div>
          <button
            type="button"
            onClick={clearPassage}
            aria-label="Don't share this passage"
            title="Don't share"
            className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-sm text-[var(--reader-text-muted)] hover:bg-[var(--reader-surface-hover)] hover:text-[var(--reader-text)]"
          >
            <X size={15} strokeWidth={2.25} />
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2 rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] py-1.5 pr-1.5 pl-3.5 focus-within:border-[var(--reader-accent)]"
      >
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={MAX_CHAT_LENGTH}
          placeholder={passage ? "Say something about it" : "Message the room"}
          aria-label="Message the room"
          className="field-sizing-content max-h-28 min-h-8 flex-1 resize-none border-none bg-transparent py-1.5 text-[14px] leading-snug text-[var(--reader-text)] outline-none placeholder:text-[var(--reader-text-subtle)]"
        />
        <button
          type="submit"
          disabled={!text.trim() || saving || connecting !== false}
          aria-label={passage ? "Share to room" : "Send"}
          title={passage ? "Share to room" : "Send"}
          className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-sm bg-[var(--reader-accent)] text-[var(--reader-bg)] transition-opacity disabled:cursor-default disabled:opacity-40"
        >
          <SendHorizontal size={16} strokeWidth={2.25} />
        </button>
      </form>
      {notice && (
        <p role="status" className="m-0 text-[11px] text-[var(--reader-text-muted)]">
          {notice}
        </p>
      )}
    </div>
  );
}

const SLOW = "One message every 2 seconds. Yours is still here.";
