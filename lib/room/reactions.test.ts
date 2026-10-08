import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { DIGEST_QUIET_MS, RISE_MS, addToBurst, createReactions, digestLine, type RisingReaction } from "./reactions";

const nameOf = (id: string) => ({ ada: "Ada", kofi: "Kofi", sekou: "Sekou" })[id] ?? id;

describe("addToBurst", () => {
  test("counts emoji, lists each reactor once, keeps the first speaker", () => {
    let burst = addToBurst(null, "kofi", ["👏🏾", "👏🏾"], "ada");
    burst = addToBurst(burst, "sekou", ["❤️"], "kofi");
    burst = addToBurst(burst, "kofi", ["❤️"], null);
    expect(burst).toEqual({ counts: { "👏🏾": 2, "❤️": 2 }, readerIds: ["kofi", "sekou"], speakerId: "ada" });
  });
});

describe("digestLine", () => {
  test("several reactors, about the speaker's point; most-used emoji first", () => {
    let burst = addToBurst(null, "kofi", ["👏🏾"], "ada");
    burst = addToBurst(burst, "sekou", ["❤️", "❤️"], null);
    expect(digestLine(burst, "me", nameOf)).toEqual({ text: "2 comrades loved Ada's point", emojis: ["❤️", "👏🏾"] });
  });

  test("a tie goes to the first used", () => {
    const burst = addToBurst(addToBurst(null, "kofi", ["🤔"], "ada"), "sekou", ["💡"], null);
    expect(digestLine(burst, "me", nameOf).text).toBe("2 comrades pondered Ada's point");
  });

  test("one reactor is named; you are You", () => {
    expect(digestLine(addToBurst(null, "kofi", ["👏🏾"], "ada"), "me", nameOf).text).toBe("Kofi applauded Ada's point");
    expect(digestLine(addToBurst(null, "me", ["🙏🏾"], "ada"), "me", nameOf).text).toBe("You thanked Ada");
  });

  test("about you, or with nobody speaking", () => {
    expect(digestLine(addToBurst(null, "kofi", ["✊🏾"], "me"), "me", nameOf).text).toBe("Kofi stood with you");
    expect(digestLine(addToBurst(null, "kofi", ["💡"], "me"), "me", nameOf).text).toBe("Kofi found insight in your point");
    expect(digestLine(addToBurst(null, "kofi", ["😮"], null), "me", nameOf).text).toBe("Kofi gasped");
  });

  test("reacting alone to your own point reads as nobody speaking", () => {
    expect(digestLine(addToBurst(null, "ada", ["❤️"], "ada"), "me", nameOf).text).toBe("Ada loved this");
  });
});

describe("createReactions", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function setup() {
    const handlers: ((payload: unknown) => void)[] = [];
    const sent: unknown[] = [];
    let rising: RisingReaction[] = [];
    const digests: string[] = [];
    const abort = new AbortController();
    const reactions = createReactions({
      readerId: "me",
      channel: {
        send: (_e: string, p: unknown) => (sent.push(p), true),
        on: (_e: string, h: (p: unknown) => void) => (handlers.push(h), () => {}),
      } as never,
      speakerId: () => "ada",
      nameOf,
      onRising: (r) => (rising = r),
      onDigest: (line) => digests.push(line.text),
      signal: abort.signal,
    });
    return { reactions, sent, rising: () => rising, digests, abort, receive: (p: unknown) => handlers.forEach((h) => h(p)) };
  }

  test("a tap is sent, rises here, and is gone after ~3 s", () => {
    const { reactions, sent, rising } = setup();
    reactions.react("👏🏾");
    expect(sent).toEqual([{ from: "me", emojis: ["👏🏾"] }]);
    expect(rising()).toMatchObject([{ readerId: "me", emoji: "👏🏾", delayMs: 0 }]);
    jest.advanceTimersByTime(RISE_MS);
    expect(rising()).toEqual([]);
  });

  test("received taps rise staggered; a burst folds into one line after 5 s quiet", () => {
    const { reactions, receive, rising, digests } = setup();
    receive({ from: "kofi", emojis: ["❤️", "❤️"] });
    expect(rising().map((r) => r.delayMs)).toEqual([0, 150]);
    jest.advanceTimersByTime(DIGEST_QUIET_MS - 1000);
    reactions.react("❤️");
    jest.advanceTimersByTime(DIGEST_QUIET_MS - 1);
    expect(digests).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(digests).toEqual(["2 comrades loved Ada's point"]);
  });

  test("stops on abort", () => {
    const { receive, digests, abort } = setup();
    receive({ from: "kofi", emojis: ["👏🏾"] });
    abort.abort();
    jest.advanceTimersByTime(DIGEST_QUIET_MS);
    expect(digests).toEqual([]);
  });
});
