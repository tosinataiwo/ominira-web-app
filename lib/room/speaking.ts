// Who is actually speaking (spec §8.7), from the levels playback measures:
// remote streams and the local mic. Pure hysteresis so rings don't flicker,
// and one 150 ms timer (not requestAnimationFrame, so background tabs stay
// cheap) that reports only when the set changes.

/** RMS of the time-domain signal; speech sits well above, suppressed room noise below. */
export const SPEAKING_THRESHOLD = 0.015;
/** Consecutive frames above the threshold before speaking starts. */
export const START_FRAMES = 2;
/** Below the threshold this long before speaking ends. */
export const HOLD_MS = 600;
export const TICK_MS = 150;

type Voice = { above: number; lastAboveAt: number; speaking: boolean };
export type SpeakingState = ReadonlyMap<string, Voice>;

export function nextSpeaking(prev: SpeakingState, levels: ReadonlyMap<string, number>, now: number): SpeakingState {
  const next = new Map<string, Voice>();
  for (const [id, level] of levels) {
    const voice = prev.get(id) ?? { above: 0, lastAboveAt: -Infinity, speaking: false };
    if (level >= SPEAKING_THRESHOLD) {
      const above = voice.above + 1;
      next.set(id, { above, lastAboveAt: now, speaking: voice.speaking || above >= START_FRAMES });
    } else {
      next.set(id, { above: 0, lastAboveAt: voice.lastAboveAt, speaking: voice.speaking && now - voice.lastAboveAt < HOLD_MS });
    }
  }
  return next;
}

/** The speaking ids, sorted, so equal sets compare equal. */
export function speakingIds(state: SpeakingState): string[] {
  return [...state].flatMap(([id, voice]) => (voice.speaking ? [id] : [])).sort();
}

export function startSpeakingDetector(options: {
  levels: () => ReadonlyMap<string, number>;
  onChange: (ids: string[]) => void;
  signal: AbortSignal;
}): void {
  let state: SpeakingState = new Map();
  let last = "";
  const timer = setInterval(() => {
    state = nextSpeaking(state, options.levels(), performance.now());
    const ids = speakingIds(state);
    const key = ids.join(",");
    if (key === last) return;
    last = key;
    options.onChange(ids);
  }, TICK_MS);
  options.signal.addEventListener("abort", () => clearInterval(timer));
}
