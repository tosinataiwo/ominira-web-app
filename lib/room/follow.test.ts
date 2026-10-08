import { describe, expect, test } from "bun:test";
import type { RoomPresence } from "./events";
import {
  NOT_FOLLOWING,
  PROGRESS_INTERVAL_MS,
  nextFollow,
  placeKey,
  positionLabel,
  progressDue,
  returnDirection,
  sectionOf,
  sendsPos,
  type FollowState,
} from "./follow";

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
  readingAloud: null,
  followingId: null,
  progressPct: 0,
  mode: "read",
  inReader: true,
  ...extra,
});

describe("nextFollow", () => {
  const following: FollowState = { targetId: "ada", paused: false };
  const paused: FollowState = { targetId: "ada", paused: true };

  test("a tap follows; the same tap again stops; another tap switches", () => {
    expect(nextFollow(NOT_FOLLOWING, { type: "tap", readerId: "ada" })).toEqual(following);
    expect(nextFollow(following, { type: "tap", readerId: "ada" })).toEqual(NOT_FOLLOWING);
    expect(nextFollow(paused, { type: "tap", readerId: "ada" })).toEqual(NOT_FOLLOWING);
    expect(nextFollow(following, { type: "tap", readerId: "sekou" })).toEqual({ targetId: "sekou", paused: false });
  });

  test("moving by hand pauses; return resumes; stop stops", () => {
    expect(nextFollow(following, { type: "scrolled" })).toEqual(paused);
    expect(nextFollow(paused, { type: "return" })).toEqual(following);
    expect(nextFollow(paused, { type: "stop" })).toEqual(NOT_FOLLOWING);
    expect(nextFollow(following, { type: "stop" })).toEqual(NOT_FOLLOWING);
  });

  test("a summon makes you follow the moderator", () => {
    expect(nextFollow(paused, { type: "summoned", from: "ada" })).toEqual(following);
    expect(nextFollow(following, { type: "summoned", from: "ada" })).toBe(following);
    expect(nextFollow(NOT_FOLLOWING, { type: "summoned", from: "ada" })).toEqual(following);
    expect(nextFollow(paused, { type: "summoned", from: "sekou" })).toEqual({ targetId: "sekou", paused: false });
  });

  test("the followed reader leaving stops following", () => {
    expect(nextFollow(paused, { type: "roster", readerIds: ["sekou"] })).toEqual(NOT_FOLLOWING);
    expect(nextFollow(following, { type: "roster", readerIds: ["ada", "sekou"] })).toBe(following);
  });

  test("events with nothing to change return the same state", () => {
    expect(nextFollow(NOT_FOLLOWING, { type: "scrolled" })).toBe(NOT_FOLLOWING);
    expect(nextFollow(NOT_FOLLOWING, { type: "return" })).toBe(NOT_FOLLOWING);
    expect(nextFollow(NOT_FOLLOWING, { type: "stop" })).toBe(NOT_FOLLOWING);
    expect(nextFollow(following, { type: "return" })).toBe(following);
    expect(nextFollow(paused, { type: "scrolled" })).toBe(paused);
  });
});

describe("returnDirection", () => {
  test("up when they're behind you, down when ahead or unknown", () => {
    expect(returnDirection(0.5, 0.2)).toBe("up");
    expect(returnDirection(0.2, 0.5)).toBe("down");
    expect(returnDirection(0.5, 0.5)).toBe("down");
    expect(returnDirection(null, 0.2)).toBe("down");
    expect(returnDirection(0.5, null)).toBe("down");
  });
});

describe("sendsPos", () => {
  test("a live mic, a moderator, or a follower", () => {
    const me = member("me");
    expect(sendsPos(me, [me])).toBe(false);
    expect(sendsPos({ ...me, micOnAt: 1 }, [me])).toBe(true);
    expect(sendsPos({ ...me, isModerator: true }, [me])).toBe(true);
    expect(sendsPos(me, [me, member("ada", { followingId: "me" })])).toBe(true);
    expect(sendsPos(me, [me, member("ada", { followingId: "sekou" })])).toBe(false);
  });
});

describe("progressDue", () => {
  const mark = { pct: 10, section: "ch1", at: 0 };
  test("first, then on a section change, then once a minute", () => {
    expect(progressDue(null, 0, "ch1", 0)).toBe(true);
    expect(progressDue(mark, 10, "ch2", 1)).toBe(false);
    expect(progressDue(mark, 12, "ch1", 1000)).toBe(false);
    expect(progressDue(mark, 12, "ch2", 1000)).toBe(true);
    expect(progressDue(mark, 12, "ch1", PROGRESS_INTERVAL_MS)).toBe(true);
  });

  test("the section is the EPUB section or the PDF page", () => {
    expect(sectionOf({ kind: "epub", sectionId: "ch3", passageIndex: 4 })).toBe("ch3");
    expect(sectionOf({ kind: "page", page: 7 })).toBe("7");
    expect(sectionOf({ kind: "block", blockIndex: 7 })).toBe("");
  });
});

describe("placeKey", () => {
  test("the same place twice is one key; a moved offset is another", () => {
    const at = { locator: { kind: "page" as const, page: 3 }, offset: 0.501 };
    expect(placeKey(at)).toBe(placeKey({ ...at, offset: 0.499 }));
    expect(placeKey(at)).not.toBe(placeKey({ ...at, offset: 0.6 }));
  });
});

describe("positionLabel", () => {
  test("exact from a place, approximate from progress, nothing to go on → null", () => {
    const place = { locator: { kind: "page" as const, page: 3 }, offset: 0, pct: 40 };
    expect(positionLabel(member("ada"), place, null)).toEqual({ text: "40% through", approximate: false });
    expect(positionLabel(member("ada", { progressPct: 12 }), undefined, null)).toEqual({
      text: "12% through",
      approximate: true,
    });
    expect(positionLabel(member("ada", { inReader: false }), undefined, null)).toBeNull();
  });
});
