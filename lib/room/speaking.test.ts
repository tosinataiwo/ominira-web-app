import { describe, expect, test } from "bun:test";
import { HOLD_MS, SPEAKING_THRESHOLD, TICK_MS, nextSpeaking, speakingIds, type SpeakingState } from "./speaking";

const loud = SPEAKING_THRESHOLD * 4;
const quiet = SPEAKING_THRESHOLD / 4;

/** Feeds frames of levels 150 ms apart; returns the speaking ids after each. */
function run(frames: Record<string, number>[]) {
  let state: SpeakingState = new Map();
  return frames.map((levels, i) => {
    state = nextSpeaking(state, new Map(Object.entries(levels)), i * TICK_MS);
    return speakingIds(state);
  });
}

describe("nextSpeaking", () => {
  test("starts after two frames above the threshold, not one", () => {
    expect(run([{ a: loud }, { a: loud }])).toEqual([[], ["a"]]);
  });

  test("a single spike never starts it", () => {
    expect(run([{ a: loud }, { a: quiet }, { a: loud }, { a: quiet }])).toEqual([[], [], [], []]);
  });

  test("short pauses inside speech don't end it", () => {
    const frames = [{ a: loud }, { a: loud }, { a: quiet }, { a: quiet }, { a: loud }, { a: quiet }];
    expect(run(frames).slice(1)).toEqual([["a"], ["a"], ["a"], ["a"], ["a"]]);
  });

  test("ends once quiet for the hold time", () => {
    const quietFrames = Math.ceil(HOLD_MS / TICK_MS);
    const frames = [{ a: loud }, { a: loud }, ...Array.from({ length: quietFrames }, () => ({ a: quiet }))];
    const result = run(frames);
    expect(result[result.length - 2]).toEqual(["a"]);
    expect(result[result.length - 1]).toEqual([]);
  });

  test("several voices at once, sorted", () => {
    expect(run([{ b: loud, a: loud, c: quiet }, { b: loud, a: loud, c: quiet }])[1]).toEqual(["a", "b"]);
  });

  test("a voice that's gone (peer closed, mic off) stops at once", () => {
    expect(run([{ a: loud }, { a: loud }, {}])).toEqual([[], ["a"], []]);
  });
});
