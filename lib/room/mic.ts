// The room's one local mic track (spec §8.5). Asked for on the first mic-on,
// never at join. Off hands peers null (replaceTrack, zero packets) but keeps
// the track for 60 s, so on again is instant; then the device is released
// (the OS mic indicator goes off) and the next on reacquires it silently.

import { setAudioSessionType } from "@/lib/room/audioSession"; // REVERT: remove with the two calls below

export type MicState = "off" | "acquiring" | "on" | "blocked";

const RELEASE_AFTER_MS = 60_000;

const CONSTRAINTS: MediaStreamConstraints = {
  // autoGainControl off: it dipped speakers' volume now and then.
  // REVERT: set autoGainControl back to true.
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
};

export type Mic = {
  /** Resolves once on, or blocked (denied, or no mic). */
  on(): Promise<void>;
  off(): void;
  readonly state: MicState;
  close(): void;
};

type Options = {
  /** The track to send: live while on, null while off. */
  onChange: (state: MicState, track: MediaStreamTrack | null) => void;
  media?: Pick<MediaDevices, "getUserMedia" | "addEventListener" | "removeEventListener">;
  releaseAfterMs?: number;
};

export function createMic(options: Options): Mic {
  const media = options.media ?? navigator.mediaDevices;
  const releaseAfterMs = options.releaseAfterMs ?? RELEASE_AFTER_MS;
  let state: MicState = "off";
  let track: MediaStreamTrack | null = null;
  let wanted = false;
  let closed = false;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let acquiring: Promise<MediaStreamTrack | null> | null = null;

  const set = (next: MicState) => {
    state = next;
    options.onChange(state, state === "on" ? track : null);
  };

  const release = () => {
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = null;
    track?.stop();
    track = null;
    setAudioSessionType("playback"); // REVERT: remove this line (iOS audio session)
  };

  const scheduleRelease = () => {
    if (track && !releaseTimer) releaseTimer = setTimeout(release, releaseAfterMs);
  };

  // One getUserMedia at a time; a second caller waits on the same one.
  const acquire = () => {
    setAudioSessionType("play-and-record"); // REVERT: remove this line (iOS audio session)
    return (acquiring ??= media
      .getUserMedia(CONSTRAINTS)
      .then((stream) => {
        const next = stream.getAudioTracks()[0] ?? null;
        if (next) {
          next.contentHint = "speech";
          // Unplugged or revoked: get the default device again while on.
          next.addEventListener("ended", () => {
            if (track === next && state === "on") void replace();
          });
        }
        return next;
      })
      .catch(() => null)
      .finally(() => {
        acquiring = null;
      }));
  };

  /** A device change while on: the new track first, then the old one goes. */
  async function replace() {
    const next = await acquire();
    if (closed || !next) return;
    const old = track;
    track = next;
    if (old !== next) old?.stop();
    if (wanted) set("on");
    else release();
  }

  const onDeviceChange = () => {
    if (state === "on") void replace();
    else if (track) release(); // the next on picks up the new default device
  };
  media.addEventListener("devicechange", onDeviceChange);

  return {
    async on() {
      if (closed) return;
      wanted = true;
      if (releaseTimer) clearTimeout(releaseTimer);
      releaseTimer = null;
      if (track?.readyState === "live") return set("on");
      set("acquiring");
      const next = await acquire();
      if (closed) return next?.stop();
      if (next) track = next;
      if (!wanted) return scheduleRelease(); // turned off while asking
      set(next ? "on" : "blocked");
    },

    off() {
      if (closed) return;
      wanted = false;
      if (state !== "off") set("off");
      scheduleRelease();
    },

    get state() {
      return state;
    },

    close() {
      closed = true;
      wanted = false;
      media.removeEventListener("devicechange", onDeviceChange);
      release();
    },
  };
}

/** "How to allow it" for a blocked mic (spec §10), by browser. */
export function micBlockedHelp(userAgent: string, ios: boolean): string {
  if (ios) return "Open the Settings app, then Safari › Microphone, choose Allow, and turn your mic on again.";
  if (/Firefox\//.test(userAgent))
    return "Click the crossed-out mic by the address bar, clear the block, then turn your mic on again.";
  if (/Safari\//.test(userAgent) && !/Chrome\/|Chromium\//.test(userAgent))
    return "In Safari's menu, open Settings for This Website, set Microphone to Allow, then turn your mic on again.";
  return "Click the mic or settings icon in the address bar, allow the microphone for this site, then turn your mic on again.";
}
