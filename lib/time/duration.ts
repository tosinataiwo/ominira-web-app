// Elapsed-time labels shared by the room and its host contexts (spec §0.1):
// "48 min", "1 h 12 min". Relative "ago" labels stay in lib/reader/timeAgo.ts.

const MINUTE = 60_000;

/** Whole minutes, floored; under a minute reads "<1 min". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE);
  if (minutes < 1) return "<1 min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
