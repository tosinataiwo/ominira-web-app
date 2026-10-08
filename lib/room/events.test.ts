import { describe, expect, test } from "bun:test";
import {
  OPEN_GATE,
  RATE_LIMITS,
  acceptSummon,
  confirmEnded,
  gateFlush,
  gateOffer,
  parseEvent,
  parsePresence,
  type Gate,
  type RateLimit,
  type RoomEvent,
} from "./events";

const ADA = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const SEKOU = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

describe("parseEvent", () => {
  test("accepts a valid pos and drops a malformed one", () => {
    const pos: RoomEvent<"pos"> = { from: ADA, locator: { kind: "page", page: 4 }, offset: 0.5, pct: 12.5 };
    expect(parseEvent("pos", pos)).toEqual(pos);
    expect(parseEvent("pos", { ...pos, offset: 2 })).toBeNull();
    expect(parseEvent("pos", { ...pos, locator: { kind: "page", page: 0 } })).toBeNull();
    expect(parseEvent("pos", { ...pos, from: "not-a-uuid" })).toBeNull();
    expect(parseEvent("pos", { ...pos, pct: 101 })).toBeNull();
    expect(parseEvent("pos", null)).toBeNull();
  });

  test("signal carries an addressed offer or answer", () => {
    const signal: RoomEvent<"signal"> = { from: ADA, to: SEKOU, kind: "description", sdp: { type: "offer", sdp: "v=0" } };
    expect(parseEvent("signal", signal)).toEqual(signal);
    expect(parseEvent("signal", { ...signal, sdp: { type: "pranswer", sdp: "v=0" } })).toBeNull();
  });

  test("chat is trimmed, non-empty and capped", () => {
    expect(parseEvent("chat", { from: ADA, text: "  hello  " })).toEqual({ from: ADA, text: "hello" });
    expect(parseEvent("chat", { from: ADA, text: "   " })).toBeNull();
    expect(parseEvent("chat", { from: ADA, text: "x".repeat(1001) })).toBeNull();
  });

  test("reaction accepts only the seven", () => {
    expect(parseEvent("reaction", { from: ADA, emojis: ["👏🏾", "✊🏾"] })).not.toBeNull();
    expect(parseEvent("reaction", { from: ADA, emojis: ["🔥"] })).toBeNull();
    expect(parseEvent("reaction", { from: ADA, emojis: [] })).toBeNull();
  });

  test("highlight null clears", () => {
    expect(parseEvent("highlight", { from: ADA, ranges: null })).toEqual({ from: ADA, ranges: null });
    expect(parseEvent("highlight", { from: ADA, ranges: [{ passageId: "p1", start: 0, end: 12 }] })).not.toBeNull();
  });

  test("ended matches end_room()'s payload", () => {
    expect(parseEvent("ended", { endedAt: "2026-10-07T21:12:00+00:00" })).not.toBeNull();
  });
});

describe("parsePresence", () => {
  const presence = {
    readerId: ADA,
    sessionId: SEKOU,
    joinedAt: 1,
    name: "Ada",
    avatar: { color: null, url: "https://example.supabase.co/storage/v1/object/public/profile-pics/a.webp" },
    isModerator: false,
    sends: false,
    micOnAt: null,
    handRaisedAt: null,
    readingAloud: null,
    followingId: null,
    progressPct: 12.5,
    mode: "read",
    inReader: true,
  };

  test("accepts a full presence and drops a partial one", () => {
    expect(parsePresence(presence)).toEqual(presence as never);
    expect(parsePresence({ ...presence, micOnAt: undefined })).toBeNull();
    expect(parsePresence({ ...presence, progressPct: 101 })).toBeNull();
    expect(parsePresence({ ...presence, avatar: { color: null, url: "javascript:alert(1)" } })).toBeNull();
    expect(parsePresence({ ...presence, avatar: { color: "pink", url: null } })).toBeNull();
  });
});

describe("receiver rules", () => {
  const summon: RoomEvent<"summon"> = { from: ADA, locator: { kind: "block", blockIndex: 3 }, offset: 0, pct: 4 };

  test("summon only from a moderator", () => {
    expect(acceptSummon(summon, [ADA])).toBe(true);
    expect(acceptSummon(summon, [SEKOU])).toBe(false);
  });

  test("ended only once rooms.status confirms it", async () => {
    expect(await confirmEnded(async () => "ended")).toBe(true);
    expect(await confirmEnded(async () => "live")).toBe(false);
    expect(await confirmEnded(async () => null)).toBe(false);
    expect(await confirmEnded(() => Promise.reject(new Error("offline")))).toBe(false);
  });
});

describe("gate", () => {
  const latest: RateLimit<number> = { intervalMs: 1000, overflow: "latest" };
  const drop: RateLimit<number> = { intervalMs: 2000, overflow: "drop" };
  const merge: RateLimit<number[]> = { intervalMs: 1000, overflow: "merge", merge: (a, b) => [...a, ...b] };

  test("first send goes straight out", () => {
    const r = gateOffer<number>(OPEN_GATE, 1, 0, latest);
    expect(r.send).toBe(1);
    expect(r.gate).toEqual({ lastSentAt: 0, held: null });
  });

  test("latest holds the newest inside the window, then flushes it", () => {
    let gate: Gate<number> = gateOffer<number>(OPEN_GATE, 1, 0, latest).gate;
    let r = gateOffer(gate, 2, 300, latest);
    expect(r.send).toBeNull();
    expect(r.flushInMs).toBe(700);
    r = gateOffer(r.gate, 3, 600, latest);
    expect(r.flushInMs).toBe(400);
    const f = gateFlush(r.gate, 1000);
    expect(f.send).toBe(3);
    gate = f.gate;
    expect(gate).toEqual({ lastSentAt: 1000, held: null });
    expect(gateFlush(gate, 1500).send).toBeNull();
  });

  test("a send while something is held joins the hold even if the window opened", () => {
    const held = gateOffer(gateOffer<number>(OPEN_GATE, 1, 0, latest).gate, 2, 500, latest).gate;
    const r = gateOffer(held, 3, 1200, latest);
    expect(r.send).toBeNull();
    expect(r.flushInMs).toBe(0);
    expect(gateFlush(r.gate, 1200).send).toBe(3);
  });

  test("drop refuses inside the window and allows after it", () => {
    const gate = gateOffer<number>(OPEN_GATE, 1, 0, drop).gate;
    const r = gateOffer(gate, 2, 1999, drop);
    expect(r.dropped).toBe(true);
    expect(r.gate).toBe(gate);
    expect(gateOffer(gate, 3, 2000, drop).send).toBe(3);
  });

  test("merge folds held payloads in order", () => {
    let r = gateOffer<number[]>(OPEN_GATE, [1], 0, merge);
    r = gateOffer(r.gate, [2], 100, merge);
    r = gateOffer(r.gate, [3], 200, merge);
    expect(gateFlush(r.gate, 1000).send).toEqual([2, 3]);
  });

  test("reaction merge keeps the newest ten taps", () => {
    const limit = RATE_LIMITS.reaction!;
    if (limit.overflow !== "merge") throw new Error("reaction should merge");
    const held: RoomEvent<"reaction"> = { from: ADA, emojis: Array(8).fill("👏🏾") };
    const merged = limit.merge(held, { from: ADA, emojis: ["❤️", "💡", "🤔"] });
    expect(merged.emojis).toHaveLength(10);
    expect(merged.emojis.slice(-3)).toEqual(["❤️", "💡", "🤔"]);
  });
});
