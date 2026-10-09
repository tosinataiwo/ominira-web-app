// iOS Safari (16.4+) lets a page say what its audio is. Left on "auto", iOS
// can treat room audio as ambient and duck it. A listener's room is
// "playback"; a live mic needs "play-and-record". No-op elsewhere.
// REVERT: delete this file and its calls in stores/room-store.ts and lib/room/mic.ts.

type AudioSessionType = "playback" | "play-and-record";

export function setAudioSessionType(type: AudioSessionType): void {
  const session = (globalThis.navigator as { audioSession?: { type: string } } | undefined)?.audioSession;
  if (!session) return;
  try {
    session.type = type;
  } catch {}
}
