import { describe, expect, test } from "bun:test";
import { acceptSignal, createSignalling, type Signal } from "./signalling";

const sdp = (type: "offer" | "answer", body = "v=0"): Signal["sdp"] => ({ type, sdp: body });
const signal = (from: string, to: string, type: "offer" | "answer" = "offer", body?: string): Signal => ({
  from,
  to,
  kind: "description",
  sdp: sdp(type, body),
});
const roster = (...ids: string[]) => ids.map((sessionId) => ({ sessionId }));

describe("acceptSignal", () => {
  test("addressed to me, from a roster session", () => {
    expect(acceptSignal(signal("a", "me"), "me", roster("me", "a"))).toBe(true);
  });

  test("not for me", () => {
    expect(acceptSignal(signal("a", "b"), "me", roster("me", "a", "b"))).toBe(false);
  });

  test("from a session not in the roster (stale or forged)", () => {
    expect(acceptSignal(signal("old", "me"), "me", roster("me", "a"))).toBe(false);
  });

  test("from myself", () => {
    expect(acceptSignal(signal("me", "me"), "me", roster("me"))).toBe(false);
  });
});

/** A channel that records sends and lets the test deliver `signal` events. */
function fakeChannel() {
  const sent: unknown[] = [];
  let handler: ((s: Signal) => void) | null = null;
  return {
    sent,
    deliver: (s: Signal) => handler?.(s),
    channel: {
      send: (event: string, payload: unknown) => {
        sent.push({ event, payload });
        return true;
      },
      on: (_event: string, h: (s: Signal) => void) => {
        handler = h;
        return () => {
          handler = null;
        };
      },
    } as never,
  };
}

function setup() {
  const fake = fakeChannel();
  const signalling = createSignalling({ channel: fake.channel, sessionId: "me" });
  signalling.setRoster(roster("me", "a", "b"));
  const got: string[] = [];
  const attach = (remote: string) => signalling.attach(remote, (s) => got.push(`${s.from}:${s.sdp.type}:${s.sdp.sdp}`));
  return { ...fake, signalling, got, attach };
}

describe("createSignalling", () => {
  test("routes each signal to its sender's peer", () => {
    const { deliver, got, attach } = setup();
    attach("a");
    attach("b");
    deliver(signal("b", "me", "answer"));
    deliver(signal("a", "me", "offer"));
    expect(got).toEqual(["b:answer:v=0", "a:offer:v=0"]);
  });

  test("drops what isn't for me or comes from outside the roster", () => {
    const { deliver, got, attach } = setup();
    attach("a");
    deliver(signal("a", "someone-else"));
    deliver(signal("stranger", "me"));
    expect(got).toEqual([]);
  });

  test("an offer before the peer exists is delivered on attach, latest only", () => {
    const { deliver, got, attach } = setup();
    deliver(signal("a", "me", "offer", "first"));
    deliver(signal("a", "me", "offer", "second"));
    expect(got).toEqual([]);
    attach("a");
    expect(got).toEqual(["a:offer:second"]);
    // Delivered once, not again on a later attach.
    attach("a");
    expect(got).toEqual(["a:offer:second"]);
  });

  test("an answer with no peer is dropped", () => {
    const { deliver, got, attach } = setup();
    deliver(signal("a", "me", "answer"));
    attach("a");
    expect(got).toEqual([]);
  });

  test("a held offer goes when its sender leaves the roster", () => {
    const { deliver, got, attach, signalling } = setup();
    deliver(signal("a", "me", "offer"));
    signalling.setRoster(roster("me", "b"));
    signalling.setRoster(roster("me", "a", "b"));
    attach("a");
    expect(got).toEqual([]);
  });

  test("a detached peer gets nothing; a stale detach doesn't remove its replacement", () => {
    const { deliver, got, attach } = setup();
    const detachOld = attach("a");
    detachOld();
    deliver(signal("a", "me", "answer"));
    expect(got).toEqual([]);
    attach("a");
    detachOld();
    deliver(signal("a", "me", "answer"));
    expect(got).toEqual(["a:answer:v=0"]);
  });

  test("a peer that hands an offer back holds it for its replacement", () => {
    const { deliver, got, attach, signalling } = setup();
    let handed: Signal | null = null;
    const detach = signalling.attach("a", (s) => (handed = s));
    deliver(signal("a", "me", "offer", "fresh"));
    detach();
    signalling.hold(handed!);
    signalling.hold(signal("a", "me", "answer")); // answers are never held
    attach("a");
    expect(got).toEqual(["a:offer:fresh"]);
  });

  test("sends addressed from my session", () => {
    const { signalling, sent } = setup();
    signalling.send("a", "restart", sdp("offer"));
    expect(sent).toEqual([{ event: "signal", payload: { from: "me", to: "a", kind: "restart", sdp: sdp("offer") } }]);
  });

  test("close stops delivery", () => {
    const { deliver, got, attach, signalling } = setup();
    attach("a");
    signalling.close();
    deliver(signal("a", "me", "answer"));
    expect(got).toEqual([]);
  });
});
