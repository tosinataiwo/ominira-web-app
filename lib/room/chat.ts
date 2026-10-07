import type { RoomChannel } from "@/lib/room/channel";
import { MAX_CHAT_LENGTH, MAX_QUOTE_LENGTH, RATE_LIMITS, type RoomEvent, type RoomPresence } from "@/lib/room/events";

// Room chat (spec §1.4, §3.2): real time and ephemeral. A reader sees what's
// said from the moment they join, it's never stored, and it's gone when the
// room ends. The channel holds chat to 1 message per 2 s (events.ts); this
// module keeps the list, the unread count and the faces. The rules are
// pure, at the top; createChat wires them to the channel for RoomSession.

/** The newest messages kept in memory; older ones drop off the top. */
export const MAX_CHAT_ITEMS = 200;
const CHAT_INTERVAL_MS = RATE_LIMITS.chat!.intervalMs;

/** The quote card on a shared passage (sharePassage.ts). */
export type SharedPassage = NonNullable<RoomEvent<"chat">["passage"]>;

export type ChatPerson = Pick<RoomPresence, "name" | "avatar">;

export type ChatItem =
  | { kind: "message"; id: string; readerId: string; text: string; at: number; passage?: SharedPassage }
  /** A reaction digest (reactions.ts): folded locally, never sent. */
  | { kind: "digest"; id: string; at: number; text: string; emojis: string[] };

export type ChatSnapshot = {
  items: ChatItem[];
  /** Others' messages since the chat was last on screen. */
  unread: number;
  /** Everyone seen in the room this visit, so a message keeps its face
   * after its sender leaves. */
  people: Record<string, ChatPerson>;
};

export const CHAT_EMPTY: ChatSnapshot = { items: [], unread: 0, people: {} };

/** Adds an item, keeping the newest MAX_CHAT_ITEMS. Others' messages count
 * as unread while the chat isn't on screen; digests and your own don't. */
export function addChatItem(chat: ChatSnapshot, item: ChatItem, o: { readerId: string; viewing: boolean }): ChatSnapshot {
  const kept = chat.items.length >= MAX_CHAT_ITEMS ? chat.items.slice(chat.items.length - MAX_CHAT_ITEMS + 1) : chat.items;
  const unread = !o.viewing && item.kind === "message" && item.readerId !== o.readerId ? chat.unread + 1 : chat.unread;
  return { ...chat, items: [...kept, item], unread };
}

/** Adds anyone new (or renamed) in the roster; the same object when nothing changed. */
export function rememberPeople(
  people: Record<string, ChatPerson>,
  roster: readonly RoomPresence[],
): Record<string, ChatPerson> {
  let next = people;
  for (const { readerId, name, avatar } of roster) {
    const known = people[readerId];
    if (known && known.name === name && known.avatar.url === avatar.url && known.avatar.color === avatar.color) continue;
    if (next === people) next = { ...people };
    next[readerId] = { name, avatar };
  }
  return next;
}

/** A passage's text on one line, cut to fit the payload. */
export function clipQuote(quote: string): string {
  const line = quote.trim().replace(/\s+/g, " ");
  return line.length <= MAX_QUOTE_LENGTH ? line : `${line.slice(0, MAX_QUOTE_LENGTH - 1).trimEnd()}…`;
}

export type Chat = {
  /** False when there's nothing to send or the rate limit refused it. */
  send(text: string, passage?: SharedPassage): boolean;
  /** False within 2 s of your last message, when a send would be refused. */
  ready(): boolean;
  /** A local line (a reaction digest). */
  add(item: ChatItem): void;
  setRoster(roster: readonly RoomPresence[]): void;
  /** The chat is on screen: nothing is unread while it is. */
  setViewing(viewing: boolean): void;
};

type ChatOptions = {
  readerId: string;
  channel: Pick<RoomChannel, "send" | "on">;
  onChange: (chat: ChatSnapshot) => void;
};

export function createChat(o: ChatOptions): Chat {
  let chat = CHAT_EMPTY;
  let viewing = false;
  let lastSentAt = -Infinity;
  let count = 0;

  const set = (next: ChatSnapshot) => {
    if (next === chat) return;
    chat = next;
    o.onChange(chat);
  };
  const add = (item: ChatItem) => set(addChatItem(chat, item, { readerId: o.readerId, viewing }));
  const nextId = () => `chat-${++count}`;

  // Broadcasts don't come back to their sender; your own are added on send.
  o.channel.on("chat", ({ from, text, passage }) => {
    if (from !== o.readerId) add({ kind: "message", id: nextId(), readerId: from, text, at: Date.now(), passage });
  });

  return {
    send(text, passage) {
      const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH);
      if (!trimmed) return false;
      const shared = passage && { quote: clipQuote(passage.quote), label: passage.label.slice(0, 200) };
      if (!o.channel.send("chat", { from: o.readerId, text: trimmed, ...(shared && { passage: shared }) })) return false;
      lastSentAt = Date.now();
      add({ kind: "message", id: nextId(), readerId: o.readerId, text: trimmed, at: lastSentAt, passage: shared });
      return true;
    },
    ready: () => Date.now() - lastSentAt >= CHAT_INTERVAL_MS,
    add: (item) => add({ ...item, id: nextId() }),
    setRoster(roster) {
      const people = rememberPeople(chat.people, roster);
      if (people !== chat.people) set({ ...chat, people });
    },
    setViewing(next) {
      viewing = next;
      if (viewing && chat.unread > 0) set({ ...chat, unread: 0 });
    },
  };
}
