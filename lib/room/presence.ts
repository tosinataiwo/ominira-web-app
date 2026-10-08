import type { RoomPresence } from "@/lib/room/events";
import { comradeName } from "@/lib/reader/authorDisplay";
import { voiceById } from "@/lib/audio/voices";

// Pure selectors over the channel's presence entries (spec §3.3, §6.2).
// Everything that lists room members goes through these.

/** Of two sessions of one reader, the one that stays (spec §8.2): the newer
 * join, with sessionId breaking a tie so every client agrees. */
function isNewer(a: RoomPresence, b: RoomPresence): boolean {
  return a.joinedAt !== b.joinedAt ? a.joinedAt > b.joinedAt : a.sessionId > b.sessionId;
}

/** One entry per reader, in join order. A reader open in two tabs is the
 * newer session (spec §8.2: the older one yields). */
export function selectRoster(entries: readonly RoomPresence[]): RoomPresence[] {
  const byReader = new Map<string, RoomPresence>();
  for (const entry of entries) {
    const held = byReader.get(entry.readerId);
    if (!held || isNewer(entry, held)) byReader.set(entry.readerId, entry);
  }
  return [...byReader.values()].sort((a, b) => a.joinedAt - b.joinedAt);
}

/** True when the same reader has a newer session in the room: this tab
 * yields (spec §8.2, "This room is open in another tab"). */
export function isSuperseded(me: RoomPresence, entries: readonly RoomPresence[]): boolean {
  return entries.some((e) => e.readerId === me.readerId && e.sessionId !== me.sessionId && isNewer(e, me));
}

/** Everyone with their mic on, newest first. */
export function selectSpeaking(roster: readonly RoomPresence[]): RoomPresence[] {
  return roster.filter((p) => p.micOnAt !== null).sort((a, b) => b.micOnAt! - a.micOnAt!);
}

/** Raised hands, first come first. */
export function selectHands(roster: readonly RoomPresence[]): RoomPresence[] {
  return roster.filter((p) => p.handRaisedAt !== null).sort((a, b) => a.handRaisedAt! - b.handRaisedAt!);
}

/** Everyone with their mic off and no hand up (Hands raised shows those),
 * in join order. */
export function selectListening(roster: readonly RoomPresence[]): RoomPresence[] {
  return roster.filter((p) => p.micOnAt === null && p.handRaisedAt === null);
}

/** The narrator voice reading aloud through this speaker's mic, by name
 * ("Leah"); null when they're not reading aloud. */
export const narratorName = (member: Pick<RoomPresence, "readingAloud">): string | null =>
  voiceById(member.readingAloud)?.name ?? null;

/** "Comrade Ada is speaking" / "… and Comrade Sekou are speaking" /
 * "…, Comrade Sekou and 2 more are speaking"; null when nobody is. A
 * speaker reading aloud is the narrator's turn, not theirs: "Leah is
 * narrating via Comrade Ada". Takes Speaking now's order (newest first). */
export function speakingLine(speakers: readonly Pick<RoomPresence, "name" | "readingAloud">[]): string | null {
  const narrating = speakers.flatMap((p) => {
    const narrator = narratorName(p);
    return narrator ? [`${narrator} is narrating via ${comradeName(p.name)}`] : [];
  });
  const [first, second, ...rest] = speakers.filter((p) => !narratorName(p)).map((p) => comradeName(p.name));
  const talking = !first
    ? null
    : !second
      ? `${first} is speaking`
      : rest.length === 0
        ? `${first} and ${second} are speaking`
        : `${first}, ${second} and ${rest.length} more are speaking`;
  const line = [...narrating, ...(talking ? [talking] : [])].join(" · ");
  return line || null;
}
