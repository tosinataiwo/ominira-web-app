import { describe, expect, test } from "bun:test";
import { createMic, micBlockedHelp, type MicState } from "./mic";

class FakeTrack {
  readyState: "live" | "ended" = "live";
  contentHint = "";
  private ended: (() => void)[] = [];
  constructor(readonly id: number) {}
  stop() {
    this.readyState = "ended";
  }
  addEventListener(_: "ended", fn: () => void) {
    this.ended.push(fn);
  }
  /** The device went away (unplugged). */
  end() {
    this.readyState = "ended";
    this.ended.forEach((fn) => fn());
  }
}

function fakeMedia(options: { deny?: boolean } = {}) {
  const tracks: FakeTrack[] = [];
  let deviceChange: (() => void) | null = null;
  let held: Promise<void> | null = null;
  let resume: (() => void) | null = null;
  return {
    tracks,
    /** Hold the next getUserMedia until `resume()`. */
    pause() {
      held = new Promise<void>((r) => (resume = r));
    },
    resume() {
      held = null;
      resume?.();
    },
    changeDevice: () => deviceChange?.(),
    media: {
      async getUserMedia() {
        if (held) await held;
        if (options.deny) throw new DOMException("denied", "NotAllowedError");
        const track = new FakeTrack(tracks.length + 1);
        tracks.push(track);
        return { getAudioTracks: () => [track] };
      },
      addEventListener: (_: string, fn: () => void) => (deviceChange = fn),
      removeEventListener: () => (deviceChange = null),
    },
  };
}

function setup(options: { deny?: boolean; releaseAfterMs?: number } = {}) {
  const fake = fakeMedia(options);
  const changes: [MicState, number | null][] = [];
  const mic = createMic({
    media: fake.media as never,
    releaseAfterMs: options.releaseAfterMs ?? 20,
    onChange: (state, track) => changes.push([state, track ? (track as unknown as FakeTrack).id : null]),
  });
  return { fake, mic, changes, last: () => changes[changes.length - 1] };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createMic", () => {
  test("first on asks once, marks the track as speech, hands it over", async () => {
    const { fake, mic, changes } = setup();
    await mic.on();
    expect(changes).toEqual([
      ["acquiring", null],
      ["on", 1],
    ]);
    expect(fake.tracks[0].contentHint).toBe("speech");
  });

  test("off hands over null and keeps the track; on again within the window reuses it", async () => {
    const { fake, mic, last } = setup({ releaseAfterMs: 50 });
    await mic.on();
    mic.off();
    expect(last()).toEqual(["off", null]);
    expect(fake.tracks[0].readyState).toBe("live");
    await mic.on();
    expect(last()).toEqual(["on", 1]);
    expect(fake.tracks.length).toBe(1);
  });

  test("the device is released after the window, and reacquired on the next on", async () => {
    const { fake, mic, last } = setup({ releaseAfterMs: 10 });
    await mic.on();
    mic.off();
    await wait(30);
    expect(fake.tracks[0].readyState).toBe("ended");
    await mic.on();
    expect(last()).toEqual(["on", 2]);
  });

  test("denied: blocked, no track", async () => {
    const { mic, last } = setup({ deny: true });
    await mic.on();
    expect(last()).toEqual(["blocked", null]);
    expect(mic.state).toBe("blocked");
  });

  test("off while still asking ends off, and the late track is released", async () => {
    const { fake, mic, last } = setup({ releaseAfterMs: 10 });
    fake.pause();
    const pending = mic.on();
    mic.off();
    expect(last()).toEqual(["off", null]);
    fake.resume();
    await pending;
    expect(mic.state).toBe("off");
    await wait(30);
    expect(fake.tracks[0].readyState).toBe("ended");
  });

  test("a device change while on swaps in a new track, then stops the old", async () => {
    const { fake, mic, last } = setup();
    await mic.on();
    fake.changeDevice();
    await wait(0);
    expect(last()).toEqual(["on", 2]);
    expect(fake.tracks[0].readyState).toBe("ended");
  });

  test("a device change while off just releases the held track", async () => {
    const { fake, mic } = setup({ releaseAfterMs: 10_000 });
    await mic.on();
    mic.off();
    fake.changeDevice();
    expect(fake.tracks[0].readyState).toBe("ended");
    expect(fake.tracks.length).toBe(1);
  });

  test("an unplugged mic while on is reacquired", async () => {
    const { fake, mic, last } = setup();
    await mic.on();
    fake.tracks[0].end();
    await wait(0);
    expect(last()).toEqual(["on", 2]);
  });

  test("close stops the track and ignores later calls", async () => {
    const { fake, mic, changes } = setup();
    await mic.on();
    mic.close();
    expect(fake.tracks[0].readyState).toBe("ended");
    const before = changes.length;
    await mic.on();
    mic.off();
    expect(changes.length).toBe(before);
  });
});

describe("micBlockedHelp", () => {
  const chrome = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
  const safari = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const firefox = "Mozilla/5.0 (Macintosh; rv:131.0) Gecko/20100101 Firefox/131.0";

  test("per browser", () => {
    expect(micBlockedHelp(chrome, false)).toContain("address bar");
    expect(micBlockedHelp(safari, false)).toContain("Settings for This Website");
    expect(micBlockedHelp(firefox, false)).toContain("crossed-out mic");
    expect(micBlockedHelp(safari, true)).toContain("Settings app");
  });
});
