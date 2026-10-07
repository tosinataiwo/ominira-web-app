import { describe, expect, test } from "bun:test";
import { CHAT_EMPTY, MAX_CHAT_ITEMS, addChatItem, clipQuote, createChat, rememberPeople, type ChatItem, type ChatSnapshot } from "./chat";
import { MAX_QUOTE_LENGTH, type RoomPresence } from "./events";

const message = (readerId: string, text = "hi"): ChatItem => ({ kind: "message", id: text, readerId, text, at: 1 });
const digest: ChatItem = { kind: "digest", id: "d", at: 1, text: "2 comrades applauded", emojis: ["👏"] };

const member = (readerId: string, name = readerId): RoomPresence => ({
  readerId,
  sessionId: `${readerId}-s`,
  joinedAt: 1,
  name,
  avatar: { color: null, url: null },
  isModerator: false,
  sends: false,
  micOnAt: null,
  handRaisedAt: null,
  followingId: null,
  progressPct: 0,
  mode: "read",
  inReader: true,
});

describe("addChatItem", () => {
  const hidden = { readerId: "me", viewing: false };

  test("others' messages are unread while the chat is off screen", () => {
    let chat = addChatItem(CHAT_EMPTY, message("ada"), hidden);
    chat = addChatItem(chat, message("me"), hidden);
    chat = addChatItem(chat, digest, hidden);
    expect(chat.unread).toBe(1);
    expect(chat.items).toHaveLength(3);
  });

  test("nothing is unread while it's on screen", () => {
    expect(addChatItem(CHAT_EMPTY, message("ada"), { readerId: "me", viewing: true }).unread).toBe(0);
  });

  test("keeps the newest MAX_CHAT_ITEMS", () => {
    let chat = CHAT_EMPTY;
    for (let i = 0; i < MAX_CHAT_ITEMS + 5; i++) chat = addChatItem(chat, message("ada", `m${i}`), hidden);
    expect(chat.items).toHaveLength(MAX_CHAT_ITEMS);
    expect(chat.items[0]).toMatchObject({ text: "m5" });
    expect(chat.items.at(-1)).toMatchObject({ text: `m${MAX_CHAT_ITEMS + 4}` });
  });
});

describe("rememberPeople", () => {
  test("adds newcomers and renames, keeps those who left, same object when unchanged", () => {
    const first = rememberPeople({}, [member("ada"), member("sekou")]);
    expect(rememberPeople(first, [member("ada")])).toBe(first);
    const renamed = rememberPeople(first, [member("ada", "Ada B")]);
    expect(renamed).not.toBe(first);
    expect(renamed.ada.name).toBe("Ada B");
    expect(renamed.sekou.name).toBe("sekou");
  });
});

test("clipQuote: one line, cut with an ellipsis", () => {
  expect(clipQuote("  two\n\nlines ")).toBe("two lines");
  const long = clipQuote("word ".repeat(400));
  expect(long.length).toBeLessThanOrEqual(MAX_QUOTE_LENGTH);
  expect(long.endsWith("…")).toBe(true);
});

describe("createChat", () => {
  function setup(accept = () => true) {
    const handlers: ((payload: unknown) => void)[] = [];
    const sent: unknown[] = [];
    const channel = {
      send: (_event: string, payload: unknown) => {
        if (!accept()) return false;
        sent.push(payload);
        return true;
      },
      on: (_event: string, handler: (payload: unknown) => void) => {
        handlers.push(handler);
        return () => {};
      },
    };
    let latest: ChatSnapshot = CHAT_EMPTY;
    const chat = createChat({ readerId: "me", channel: channel as never, onChange: (c) => (latest = c) });
    return { chat, sent, receive: (p: unknown) => handlers.forEach((h) => h(p)), latest: () => latest };
  }

  test("your message is sent and shown; a blank one isn't", () => {
    const { chat, sent, latest } = setup();
    expect(chat.send("   ")).toBe(false);
    expect(chat.send("  hello  ")).toBe(true);
    expect(sent).toEqual([{ from: "me", text: "hello" }]);
    expect(latest().items).toMatchObject([{ kind: "message", readerId: "me", text: "hello" }]);
    expect(chat.ready()).toBe(false);
  });

  test("refused by the rate limit: not shown", () => {
    const { chat, latest } = setup(() => false);
    expect(chat.send("hello")).toBe(false);
    expect(latest().items).toHaveLength(0);
    expect(chat.ready()).toBe(true);
  });

  test("a shared passage carries its clipped quote", () => {
    const { chat, sent } = setup();
    chat.send("look", { quote: " the\nveil ", label: "Ch. I" });
    expect(sent).toEqual([{ from: "me", text: "look", passage: { quote: "the veil", label: "Ch. I" } }]);
  });

  test("received messages count as unread until the chat is on screen", () => {
    const { chat, receive, latest } = setup();
    receive({ from: "ada", text: "one" });
    receive({ from: "ada", text: "two" });
    expect(latest().unread).toBe(2);
    chat.setViewing(true);
    expect(latest().unread).toBe(0);
    receive({ from: "ada", text: "three" });
    expect(latest().unread).toBe(0);
    expect(latest().items.map((i) => i.kind === "message" && i.text)).toEqual(["one", "two", "three"]);
  });

  test("the roster's faces are remembered, without a change when nothing's new", () => {
    const { chat, latest } = setup();
    chat.setRoster([member("ada")]);
    const after = latest();
    expect(after.people.ada.name).toBe("ada");
    chat.setRoster([member("ada")]);
    expect(latest()).toBe(after);
  });
});
