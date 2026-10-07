import type { RoomChannel } from "@/lib/room/channel";
import type { RoomReaction } from "@/lib/room/events";

// Reactions (spec §1.5, §6.2): the seven emoji (events.ts ROOM_REACTIONS),
// rising over the room with the reactor's name for about 3 s, and folded
// into one chat line once 5 s pass without a new one (the digest, "6
// comrades loved Ada's point"). Each client folds what it receives, so a
// digest costs no messages. The channel coalesces taps to ≤ 1 message a
// second (events.ts RATE_LIMITS), so there's no send timer here. The rules
// are pure, at the top; createReactions wires them for RoomSession.

/** How long a reaction rises. */
export const RISE_MS = 3000;
/** Quiet this long folds the burst into a chat line. */
export const DIGEST_QUIET_MS = 5000;
/** Taps carried in one message rise this far apart. */
const STAGGER_MS = 150;
/** More than this at once and the oldest go first. */
const MAX_RISING = 12;

export type RisingReaction = { id: string; readerId: string; emoji: RoomReaction; delayMs: number };

/** The reactions since the last quiet stretch. `speakerId`: who was
 * speaking when it began, whose point it's about. */
export type Burst = {
  counts: Partial<Record<RoomReaction, number>>;
  readerIds: string[];
  speakerId: string | null;
};

export function addToBurst(
  burst: Burst | null,
  readerId: string,
  emojis: readonly RoomReaction[],
  speakerId: string | null,
): Burst {
  const counts = { ...burst?.counts };
  for (const emoji of emojis) counts[emoji] = (counts[emoji] ?? 0) + 1;
  const readerIds = burst?.readerIds.includes(readerId) ? burst.readerIds : [...(burst?.readerIds ?? []), readerId];
  return { counts, readerIds, speakerId: burst ? burst.speakerId : speakerId };
}

/** What the most-used reaction says: about the speaker's point, or with
 * nobody speaking. `{point}` is "Ada's point", `{who}` is "Ada". */
const DIGEST_PHRASES: Record<RoomReaction, { speaker: string; alone: string }> = {
  "👏": { speaker: "applauded {point}", alone: "applauded" },
  "❤️": { speaker: "loved {point}", alone: "loved this" },
  "💡": { speaker: "found insight in {point}", alone: "found insight here" },
  "🤔": { speaker: "pondered {point}", alone: "pondered this" },
  "😮": { speaker: "gasped at {point}", alone: "gasped" },
  "🙏": { speaker: "thanked {who}", alone: "gave thanks" },
  "✊🏾": { speaker: "stood with {who}", alone: "stood in solidarity" },
};

/** The burst as a chat line: "6 comrades loved Ada's point", "Kofi
 * applauded", "You thanked Ada". The emoji go most-used first. `nameOf`
 * gives a reader's display name. A lone reactor reacting to their own
 * point reads as nobody speaking. */
export function digestLine(
  burst: Burst,
  readerId: string,
  nameOf: (readerId: string) => string,
): { text: string; emojis: RoomReaction[] } {
  const emojis = (Object.keys(burst.counts) as RoomReaction[]).sort((a, b) => burst.counts[b]! - burst.counts[a]!);
  const [only] = burst.readerIds;
  const who =
    burst.readerIds.length > 1 ? `${burst.readerIds.length} comrades` : only === readerId ? "You" : nameOf(only);
  const speaker = burst.speakerId && !(burst.readerIds.length === 1 && only === burst.speakerId) ? burst.speakerId : null;
  const phrase = DIGEST_PHRASES[emojis[0]];
  const text = speaker
    ? phrase.speaker
        .replace("{point}", speaker === readerId ? "your point" : `${nameOf(speaker)}'s point`)
        .replace("{who}", speaker === readerId ? "you" : nameOf(speaker))
    : phrase.alone;
  return { text: `${who} ${text}`, emojis };
}

export type Reactions = {
  /** A tap in the tray: rises here at once, sent coalesced. */
  react(emoji: RoomReaction): void;
};

type ReactionsOptions = {
  readerId: string;
  channel: Pick<RoomChannel, "send" | "on">;
  /** Who's speaking now, for a new burst. */
  speakerId: () => string | null;
  nameOf: (readerId: string) => string;
  onRising: (rising: RisingReaction[]) => void;
  onDigest: (line: { text: string; emojis: RoomReaction[] }) => void;
  signal: AbortSignal;
};

export function createReactions(o: ReactionsOptions): Reactions {
  let rising: RisingReaction[] = [];
  let burst: Burst | null = null;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let count = 0;

  const receive = (readerId: string, emojis: readonly RoomReaction[]) => {
    const added = emojis.map((emoji, i) => ({ id: `rise-${++count}`, readerId, emoji, delayMs: i * STAGGER_MS }));
    rising = [...rising, ...added].slice(-MAX_RISING);
    o.onRising(rising);
    const ids = new Set(added.map((r) => r.id));
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        rising = rising.filter((r) => !ids.has(r.id));
        o.onRising(rising);
      },
      RISE_MS + (emojis.length - 1) * STAGGER_MS,
    );
    timers.add(timer);

    burst = addToBurst(burst, readerId, emojis, o.speakerId());
    clearTimeout(quiet);
    quiet = setTimeout(() => {
      if (burst) o.onDigest(digestLine(burst, o.readerId, o.nameOf));
      burst = null;
    }, DIGEST_QUIET_MS);
  };

  o.channel.on("reaction", ({ from, emojis }) => {
    if (from !== o.readerId) receive(from, emojis);
  });

  o.signal.addEventListener("abort", () => {
    clearTimeout(quiet);
    for (const timer of timers) clearTimeout(timer);
  });

  return {
    react(emoji) {
      if (o.signal.aborted) return;
      o.channel.send("reaction", { from: o.readerId, emojis: [emoji] });
      receive(o.readerId, [emoji]);
    },
  };
}
