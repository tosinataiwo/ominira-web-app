import { describe, expect, test } from "bun:test";
import type { RoomPresence } from "./events";
import { isSuperseded, selectHands, selectListening, selectRoster, selectSpeaking, speakingLine } from "./presence";

const member = (readerId: string, joinedAt: number, extra: Partial<RoomPresence> = {}): RoomPresence => ({
  readerId,
  sessionId: `${readerId}-${joinedAt}`,
  joinedAt,
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

const ids = (list: RoomPresence[]) => list.map((p) => p.readerId);

describe("selectRoster", () => {
  test("one entry per reader, newer session wins, join order", () => {
    const roster = selectRoster([member("ada", 3), member("sekou", 1), member("ada", 5), member("kofi", 2)]);
    expect(ids(roster)).toEqual(["sekou", "kofi", "ada"]);
    expect(roster[2].sessionId).toBe("ada-5");
  });

  test("the older tab arriving later doesn't replace the newer", () => {
    expect(selectRoster([member("ada", 5), member("ada", 3)])[0].sessionId).toBe("ada-5");
  });

  test("empty", () => {
    expect(selectRoster([])).toEqual([]);
  });

  test("a tie on joinedAt goes to the higher sessionId", () => {
    const a = member("ada", 5, { sessionId: "a" });
    const b = member("ada", 5, { sessionId: "b" });
    expect(selectRoster([b, a])[0].sessionId).toBe("b");
    expect(selectRoster([a, b])[0].sessionId).toBe("b");
  });
});

describe("isSuperseded", () => {
  const older = member("ada", 3);
  const newer = member("ada", 5);

  test("the older tab yields to the newer, not the other way", () => {
    expect(isSuperseded(older, [older, newer, member("sekou", 9)])).toBe(true);
    expect(isSuperseded(newer, [older, newer])).toBe(false);
  });

  test("alone, or beside other readers, nobody yields", () => {
    expect(isSuperseded(older, [older])).toBe(false);
    expect(isSuperseded(older, [older, member("sekou", 9)])).toBe(false);
  });

  test("a tie agrees with selectRoster", () => {
    const a = member("ada", 5, { sessionId: "a" });
    const b = member("ada", 5, { sessionId: "b" });
    expect(isSuperseded(a, [a, b])).toBe(true);
    expect(isSuperseded(b, [a, b])).toBe(false);
  });
});

describe("sections", () => {
  const roster = selectRoster([
    member("ada", 1, { micOnAt: 100 }),
    member("sekou", 2, { micOnAt: 300 }),
    member("kofi", 3, { handRaisedAt: 250 }),
    member("amara", 4, { handRaisedAt: 200 }),
    member("tunde", 5),
  ]);

  test("speaking: mic on, newest first", () => {
    expect(ids(selectSpeaking(roster))).toEqual(["sekou", "ada"]);
  });

  test("hands: first come first", () => {
    expect(ids(selectHands(roster))).toEqual(["amara", "kofi"]);
  });

  test("listening: mic off, join order, hands included", () => {
    expect(ids(selectListening(roster))).toEqual(["kofi", "amara", "tunde"]);
  });

  test("nobody speaking", () => {
    expect(selectSpeaking([member("tunde", 1)])).toEqual([]);
  });
});

describe("speakingLine", () => {
  const named = (...names: string[]) => names.map((name) => ({ name }));

  test("nobody, one, two, many", () => {
    expect(speakingLine([])).toBeNull();
    expect(speakingLine(named("Ada"))).toBe("Comrade Ada is speaking");
    expect(speakingLine(named("Ada", "Comrade Sekou"))).toBe("Comrade Ada and Comrade Sekou are speaking");
    expect(speakingLine(named("Ada", "Sekou", "Kofi", "Amara"))).toBe("Comrade Ada, Comrade Sekou and 2 more are speaking");
  });
});
