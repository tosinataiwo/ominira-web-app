import type { RoomPlace, RoomPresence } from "@/lib/room/events";

// What the text shows of the room (spec §1.3, §3.1), as pure selectors:
// the quiet margin, the "N reading" chip, and the speaker band.

type Others = { readerId: string; followingId: string | null };

/** The quiet margin: live mics, moderators and the one you follow, at their
 * exact place, so only readers sending `pos` and inside the book's reader. */
export function selectMargin(
  roster: readonly RoomPresence[],
  places: Readonly<Record<string, RoomPlace>>,
  { readerId, followingId }: Others,
): { member: RoomPresence; place: RoomPlace }[] {
  return roster.flatMap((member) => {
    const place = places[member.readerId];
    const shown =
      member.readerId !== readerId &&
      member.inReader &&
      place &&
      (member.micOnAt !== null || member.isModerator || member.readerId === followingId);
    return shown ? [{ member, place }] : [];
  });
}

/** "N reading": everyone else inside the book's reader who isn't in the margin. */
export function selectReadingCount(
  roster: readonly RoomPresence[],
  readerId: string,
  inMargin: readonly string[],
): number {
  return roster.filter((p) => p.readerId !== readerId && p.inReader && !inMargin.includes(p.readerId)).length;
}

/** The speaker band: the most recent selection of anyone else with their
 * mic on, or null. */
export function selectBand<H extends { at: number }>(
  roster: readonly RoomPresence[],
  highlights: Readonly<Record<string, H>>,
  readerId: string,
): { member: RoomPresence; highlight: H } | null {
  let band: { member: RoomPresence; highlight: H } | null = null;
  for (const member of roster) {
    const highlight = highlights[member.readerId];
    if (!highlight || member.readerId === readerId || member.micOnAt === null) continue;
    if (!band || highlight.at > band.highlight.at) band = { member, highlight };
  }
  return band;
}

/** Margin avatars at their lines, nudged apart so none overlap: each sits
 * below the one before it by at least `size` (input in any order). */
export function spreadLines<T extends { y: number }>(items: readonly T[], size: number): (T & { top: number })[] {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  let floor = -Infinity;
  return sorted.map((item) => {
    const top = Math.max(item.y - size / 2, floor);
    floor = top + size + 2;
    return { ...item, top };
  });
}
