import { z } from "zod";
import type { AnnotationRange } from "@/lib/api/types";
import { AVATAR_COLORS, type AvatarColor } from "@/lib/avatar/avatar";
import type { Locator } from "@/lib/reader/locator";

// The room's one event contract (spec §0.4, §6.2): every presence field and
// broadcast payload is declared here, with its rate limit, and nowhere else.
// Realtime checks channel RLS only at join, so any member can send anything:
// receivers parse every payload with these schemas and drop what fails.

/** The seven reactions (spec §1.5). Note reactions are a single ✊🏾, so the
 * room's set lives here, with the payload that carries it. */
export const ROOM_REACTIONS = [
  { emoji: "👏", label: "Applause" },
  { emoji: "❤️", label: "Love" },
  { emoji: "💡", label: "Insight" },
  { emoji: "🤔", label: "Thinking" },
  { emoji: "😮", label: "Wow" },
  { emoji: "🙏", label: "Thanks" },
  { emoji: "✊🏾", label: "Solidarity" },
] as const;

export type RoomReaction = (typeof ROOM_REACTIONS)[number]["emoji"];

export const MAX_CHAT_LENGTH = 1000;
/** A shared passage's quote in chat; the note keeps the full ranges. */
export const MAX_QUOTE_LENGTH = 600;
/** Taps folded into one coalesced `reaction` message. */
const MAX_REACTIONS_PER_SEND = 10;

const id = z.uuid();

const LocatorSchema: z.ZodType<Locator> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("epub"), sectionId: z.string().max(200), passageIndex: z.int().nonnegative() }),
  z.object({ kind: z.literal("page"), page: z.int().positive() }),
  z.object({ kind: z.literal("block"), blockIndex: z.int().nonnegative() }),
]);

const RangeSchema: z.ZodType<AnnotationRange> = z.object({
  passageId: z.string().max(200),
  start: z.int().nonnegative(),
  end: z.int().nonnegative(),
  text: z.string().max(5000).optional(),
});

/** A place in the text: the locator plus a 0–1 offset within it (spec §9),
 * and how far through the book it is (0–100), which a reader whose view
 * can't place the locator follows instead (mixed formats). */
const PlaceSchema = z.object({
  locator: LocatorSchema,
  offset: z.number().min(0).max(1),
  pct: z.number().min(0).max(100),
});

export type RoomPlace = z.infer<typeof PlaceSchema>;

/** What each member tracks in presence, sent on change only (spec §6.2).
 * Keyed by readerId; peers are keyed by sessionId (spec §8.2). */
export const PresenceSchema = z.object({
  readerId: id,
  sessionId: id,
  /** Epoch ms this session joined; the newer of two tabs wins (spec §8.2). */
  joinedAt: z.number(),
  /** Pseudonym and avatar from room-join (the reader's own row). */
  name: z.string().min(1).max(100),
  avatar: z.object({
    color: z.enum(Object.keys(AVATAR_COLORS) as [AvatarColor, ...AvatarColor[]]).nullable(),
    url: z.url({ protocol: /^https$/ }).max(2048).nullable(),
  }),
  /** From room-join, display only. */
  isModerator: z.boolean(),
  /** Has had the mic on this session; drives topology (spec §8.3). */
  sends: z.boolean(),
  /** Epoch ms the mic went on, null when off; orders Speaking now. */
  micOnAt: z.number().nullable(),
  /** Epoch ms; orders hands first come. */
  handRaisedAt: z.number().nullable(),
  /** The readerId being followed. */
  followingId: id.nullable(),
  progressPct: z.number().min(0).max(100),
  mode: z.enum(["read", "listen"]),
  inReader: z.boolean(),
});

export type RoomPresence = z.infer<typeof PresenceSchema>;

/** Broadcast payloads by event. `from` is the sender's sessionId on `signal`
 * (peers are per session) and readerId everywhere else. Supabase doesn't
 * authenticate it per message; spec §8.9 accepts that for v1. */
export const EVENT_SCHEMAS = {
  /** Addressed offer/answer; one of each per pair (non-trickle ICE, spec §8.4). */
  signal: z.object({
    from: id,
    to: id,
    kind: z.enum(["description", "restart"]),
    sdp: z.object({ type: z.enum(["offer", "answer"]), sdp: z.string().max(100_000) }),
  }),
  pos: PlaceSchema.extend({ from: id }),
  /** The speaker's selection; null clears it. */
  highlight: z.object({ from: id, ranges: z.array(RangeSchema).max(50).nullable() }),
  summon: PlaceSchema.extend({ from: id }),
  chat: z.object({
    from: id,
    text: z.string().trim().min(1).max(MAX_CHAT_LENGTH),
    /** Share passage (spec §1.4): the quote card. The note itself is saved
     * through the notes API, so nothing here is stored. */
    passage: z.object({ quote: z.string().min(1).max(MAX_QUOTE_LENGTH), label: z.string().max(200) }).optional(),
  }),
  /** Coalesced taps, in tap order. */
  reaction: z.object({
    from: id,
    emojis: z.array(z.enum(ROOM_REACTIONS.map((r) => r.emoji))).min(1).max(MAX_REACTIONS_PER_SEND),
  }),
  /** Sent by end_room() in SQL only. */
  ended: z.object({ endedAt: z.string() }),
};

export type RoomEventName = keyof typeof EVENT_SCHEMAS;
export type RoomEvent<E extends RoomEventName> = z.infer<(typeof EVENT_SCHEMAS)[E]>;
/** Clients never send `ended`. */
export type ClientEventName = Exclude<RoomEventName, "ended">;

/** A received payload, or null when it doesn't match the contract. */
export function parseEvent<E extends RoomEventName>(event: E, payload: unknown): RoomEvent<E> | null {
  const result = EVENT_SCHEMAS[event].safeParse(payload);
  return result.success ? (result.data as RoomEvent<E>) : null;
}

export function parsePresence(payload: unknown): RoomPresence | null {
  const result = PresenceSchema.safeParse(payload);
  return result.success ? result.data : null;
}

// ── Receiver rules (reading-room-tasks.md log) ──────────────────────────────

/** `summon` counts only from a moderator (`moderatorIds` from room-join). */
export function acceptSummon(event: RoomEvent<"summon">, moderatorIds: readonly string[]): boolean {
  return moderatorIds.includes(event.from);
}

/** `ended` is honoured only once `rooms.status` says so; a failed read
 * ignores it (the heartbeat catches a real end anyway). */
export async function confirmEnded(readStatus: () => Promise<string | null>): Promise<boolean> {
  return (await readStatus().catch(() => null)) === "ended";
}

// ── Rate limits (spec §5, §6.2) ─────────────────────────────────────────────

/** What happens to a send inside the window: `drop` refuses it, `latest`
 * holds it (replacing any held one) until the window opens, `merge` folds it
 * into the held one. */
export type RateLimit<P> =
  | { intervalMs: number; overflow: "drop" | "latest" }
  | { intervalMs: number; overflow: "merge"; merge: (held: P, next: P) => P };

/** Events not listed here (`signal`, `summon`) send as they come. */
export const RATE_LIMITS: { [E in ClientEventName]?: RateLimit<RoomEvent<E>> } = {
  pos: { intervalMs: 1000, overflow: "latest" },
  highlight: { intervalMs: 1000, overflow: "latest" },
  chat: { intervalMs: 2000, overflow: "drop" },
  reaction: {
    intervalMs: 1000,
    overflow: "merge",
    merge: (held, next) => ({ from: next.from, emojis: [...held.emojis, ...next.emojis].slice(-MAX_REACTIONS_PER_SEND) }),
  },
};

/** One event's limiter state. The channel owns one per limited event and
 * the timer; the rules are here, pure. */
export type Gate<P> = { lastSentAt: number | null; held: P | null };

export const OPEN_GATE: Gate<never> = { lastSentAt: null, held: null };

export type GateResult<P> = {
  gate: Gate<P>;
  /** Send this now. */
  send: P | null;
  /** Something is held: call gateFlush in this many ms. */
  flushInMs: number | null;
  /** Refused (`drop`); the UI can say so. */
  dropped: boolean;
};

export function gateOffer<P>(gate: Gate<P>, payload: P, now: number, limit: RateLimit<P>): GateResult<P> {
  const wait = gate.lastSentAt === null ? 0 : Math.max(0, gate.lastSentAt + limit.intervalMs - now);
  if (wait === 0 && gate.held === null) {
    return { gate: { lastSentAt: now, held: null }, send: payload, flushInMs: null, dropped: false };
  }
  if (limit.overflow === "drop") return { gate, send: null, flushInMs: null, dropped: true };
  const held = limit.overflow === "merge" && gate.held !== null ? limit.merge(gate.held, payload) : payload;
  return { gate: { lastSentAt: gate.lastSentAt, held }, send: null, flushInMs: wait, dropped: false };
}

/** The window has opened: send whatever is held. */
export function gateFlush<P>(gate: Gate<P>, now: number): { gate: Gate<P>; send: P | null } {
  if (gate.held === null) return { gate, send: null };
  return { gate: { lastSentAt: now, held: null }, send: gate.held };
}
