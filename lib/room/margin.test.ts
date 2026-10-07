import { describe, expect, test } from "bun:test";
import type { RoomPlace, RoomPresence } from "./events";
import { selectBand, selectMargin, selectReadingCount, spreadLines } from "./margin";

const member = (readerId: string, extra: Partial<RoomPresence> = {}): RoomPresence => ({
  readerId,
  sessionId: `${readerId}-s`,
  joinedAt: 1,
  name: readerId,
  avatar: { color: null, url: null },
  isModerator: false,
  sends: false,
  micOnAt: null,
  handRaisedAt: null,
  followingId: null,
  progressPct: 0,
  mode: "read",
  inReader: true,
  ...extra,
});

const at = (page: number): RoomPlace => ({ locator: { kind: "page", page }, offset: 0, pct: page });

describe("selectMargin", () => {
  const roster = [
    member("me", { micOnAt: 1 }),
    member("speaker", { micOnAt: 2 }),
    member("mod", { isModerator: true }),
    member("followed"),
    member("reader"),
    member("away", { micOnAt: 3, inReader: false }),
    member("noPlace", { micOnAt: 4 }),
  ];
  const places = { me: at(1), speaker: at(2), mod: at(3), followed: at(4), reader: at(5), away: at(6) };

  test("live mics, moderators and the one you follow, with a place, inside the reader; never you", () => {
    const margin = selectMargin(roster, places, { readerId: "me", followingId: "followed" });
    expect(margin.map((m) => m.member.readerId)).toEqual(["speaker", "mod", "followed"]);
    expect(margin[0].place).toBe(places.speaker);
  });

  test("not following anyone: the followed reader is just a reader", () => {
    const margin = selectMargin(roster, places, { readerId: "me", followingId: null });
    expect(margin.map((m) => m.member.readerId)).toEqual(["speaker", "mod"]);
  });
});

describe("selectReadingCount", () => {
  test("everyone else in the reader, minus the margin", () => {
    const roster = [member("me"), member("a"), member("b"), member("c", { inReader: false }), member("d")];
    expect(selectReadingCount(roster, "me", ["d"])).toBe(2);
    expect(selectReadingCount(roster, "me", [])).toBe(3);
    expect(selectReadingCount([member("me")], "me", [])).toBe(0);
  });
});

describe("selectBand", () => {
  const ranges = [{ passageId: "p1", start: 0, end: 5 }];
  test("the most recent selection of someone else with a live mic", () => {
    const roster = [member("me", { micOnAt: 1 }), member("ada", { micOnAt: 2 }), member("sekou", { micOnAt: 3 }), member("kofi")];
    const highlights = {
      me: { ranges, at: 50 },
      ada: { ranges, at: 10 },
      sekou: { ranges, at: 20 },
      kofi: { ranges, at: 30 },
    };
    expect(selectBand(roster, highlights, "me")?.member.readerId).toBe("sekou");
    expect(selectBand(roster, { ada: highlights.ada }, "me")?.member.readerId).toBe("ada");
    expect(selectBand(roster, { kofi: highlights.kofi, me: highlights.me }, "me")).toBeNull();
  });
});

describe("spreadLines", () => {
  test("keeps lines apart by the avatar size, in line order", () => {
    const spread = spreadLines([{ id: "b", y: 105 }, { id: "a", y: 100 }, { id: "c", y: 300 }], 22);
    expect(spread.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(spread[0].top).toBe(89);
    expect(spread[1].top).toBe(113);
    expect(spread[2].top).toBe(289);
  });
});
