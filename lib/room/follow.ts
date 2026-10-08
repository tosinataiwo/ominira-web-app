import type { RoomChannel } from "@/lib/room/channel";
import { acceptSummon, type RoomPlace, type RoomPresence } from "@/lib/room/events";
import type { ReaderView, ViewPlace } from "@/lib/room/view";
import type { Locator } from "@/lib/reader/locator";

// Everything about following (spec §0.2, §9), and the only module that
// touches `pos`, `followingId` and `summon`: who you follow, when your place
// is sent and how a followed place is shown, the following → paused →
// returned / stopped machine behind the pill and the frame, the Return
// arrow, the mixed-format percentage fallback, a moderator's Bring everyone
// to my page, and your progress in presence. The rules are pure, at the
// top; createFollow wires them to the channel and the open reader
// (lib/room/view.ts) for RoomSession.

/** The same settle as useProgressCommit's: the reader has stopped moving. */
const SETTLE_MS = 600;
/** progressPct moves at most this often, unless the section or page changes (spec §6.2). */
export const PROGRESS_INTERVAL_MS = 60_000;
/** Keys that move a reader by hand (useDocumentKeyboard, the carousel). */
const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "]);

// ── The follow state machine (pure) ─────────────────────────────────────────

export type FollowState = { targetId: string | null; paused: boolean };

export const NOT_FOLLOWING: FollowState = { targetId: null, paused: false };

export type FollowEvent =
  /** A tap on an avatar: follow them, or stop if it's who you follow (spec §1.6). */
  | { type: "tap"; readerId: string }
  /** × on the pill. */
  | { type: "stop" }
  /** You moved by hand: following pauses, the pill offers Return. */
  | { type: "scrolled" }
  | { type: "return" }
  /** A moderator brought everyone to their page: you follow them (spec §9). */
  | { type: "summoned"; from: string }
  /** The one you follow left the room. */
  | { type: "roster"; readerIds: readonly string[] };

/** The next state; the same object when nothing changes. */
export function nextFollow(state: FollowState, event: FollowEvent): FollowState {
  switch (event.type) {
    case "tap":
      return state.targetId === event.readerId ? NOT_FOLLOWING : { targetId: event.readerId, paused: false };
    case "stop":
      return state.targetId === null ? state : NOT_FOLLOWING;
    case "scrolled":
      return state.targetId !== null && !state.paused ? { ...state, paused: true } : state;
    case "return":
      return state.paused ? { ...state, paused: false } : state;
    case "summoned":
      return state.targetId === event.from && !state.paused ? state : { targetId: event.from, paused: false };
    case "roster":
      return state.targetId !== null && !event.readerIds.includes(state.targetId) ? NOT_FOLLOWING : state;
  }
}

export type Direction = "up" | "down";

/** The Return pill's arrow: up when the followed reader is behind you. */
export function returnDirection(mine: number | null, theirs: number | null): Direction {
  return mine !== null && theirs !== null && theirs < mine ? "up" : "down";
}

/** Who sends `pos` (spec §6.2): anyone with a follower, a live mic, or a moderator. */
export function sendsPos(me: RoomPresence, roster: readonly RoomPresence[]): boolean {
  return (
    me.micOnAt !== null ||
    me.isModerator ||
    roster.some((p) => p.followingId === me.readerId && p.readerId !== me.readerId)
  );
}

/** The part of a locator whose change sends progress at once: the EPUB
 * section or the PDF page. Block formats have neither. */
export function sectionOf(locator: Locator): string {
  return locator.kind === "epub" ? locator.sectionId : locator.kind === "page" ? String(locator.page) : "";
}

export type ProgressMark = { pct: number; section: string; at: number };

/** Whether progressPct should move: it changed, and a minute has passed
 * or the section or page did (spec §6.2). */
export function progressDue(last: ProgressMark | null, pct: number, section: string, now: number): boolean {
  if (!last) return true;
  if (last.pct === pct) return false;
  return section !== last.section || now - last.at >= PROGRESS_INTERVAL_MS;
}

/** One key per place, so an unchanged place isn't sent again. */
export function placeKey({ locator, offset }: ViewPlace): string {
  return `${JSON.stringify(locator)}@${offset.toFixed(2)}`;
}

/** A sent place as this view can show it: by its locator, or by percentage
 * when the view can't address it (mixed formats, spec §9). */
export function resolvePlace(view: ReaderView, place: RoomPlace): ViewPlace | undefined {
  return view.fraction(place) !== null ? place : view.placeAt(place.pct / 100);
}

/** "p. 4" for a member (spec §3.3): from their exact place when they send
 * one, else from presence progress, which is approximate. Null when there's
 * nothing to go on. */
export function positionLabel(
  member: Pick<RoomPresence, "progressPct" | "inReader">,
  place: RoomPlace | undefined,
  view: ReaderView | null,
): { text: string; approximate: boolean } | null {
  const pct = place?.pct ?? member.progressPct;
  if (!place && !member.inReader && pct === 0) return null;
  const shown = view && (place ? resolvePlace(view, place) : view.placeAt(pct / 100));
  return { text: shown ? view.label(shown) : `${Math.round(pct)}% through`, approximate: !place };
}

// ── The controller ──────────────────────────────────────────────────────────

export type FollowSnapshot = {
  /** The readerId you follow. */
  targetId: string | null;
  /** You moved away by hand: the pill reads Return, the frame drops. */
  paused: boolean;
  /** Toward the followed reader, for the Return pill. */
  direction: Direction;
  /** The latest exact place of each reader sending `pos`, by readerId. */
  places: Record<string, RoomPlace>;
};

export const FOLLOW_IDLE: FollowSnapshot = { ...NOT_FOLLOWING, direction: "down", places: {} };

export type Follow = {
  /** The open reader, or null; ignored unless it's the room's book. */
  setView(view: ReaderView | null): void;
  setRoster(roster: readonly RoomPresence[]): void;
  /** The reader settled somewhere, or what you are changed (mic, moderator):
   * send your place and progress if they're due. */
  moved(): void;
  follow(readerId: string): void;
  unfollow(): void;
  returnToFollowed(): void;
  /** Moderators: false when there's no place to send (not in the reader). */
  summonEveryone(): boolean;
  close(): void;
};

type FollowOptions = {
  readerId: string;
  roomMaterialId: string;
  /** Receivers honour `summon` only from these, or a moderator in the
   * roster (events.ts acceptSummon). */
  moderatorIds: readonly string[];
  channel: Pick<RoomChannel, "send" | "on">;
  /** Your presence now, and a change to it. */
  presence: () => RoomPresence | null;
  updatePresence: (change: Partial<RoomPresence>) => void;
  onChange: (snapshot: FollowSnapshot) => void;
  signal: AbortSignal;
};

export function createFollow(o: FollowOptions): Follow {
  let state = NOT_FOLLOWING;
  let snapshot = FOLLOW_IDLE;
  let view: ReaderView | null = null;
  let detachView: AbortController | null = null;
  let roster: readonly RoomPresence[] = [];
  let followerIds = new Set<string>();
  let memberIds = new Set<string>();
  /** The last place sent, so an unchanged one isn't sent again. */
  let sent: string | null = null;
  let progress: ProgressMark | null = null;
  let settle: ReturnType<typeof setTimeout> | undefined;

  const emit = (change: Partial<FollowSnapshot>) => {
    snapshot = { ...snapshot, ...change };
    o.onChange(snapshot);
  };

  /** Your place as sent: with how far through the book it is. */
  const placeOf = (here: ViewPlace | undefined): RoomPlace | undefined => {
    const fraction = here && view?.fraction(here);
    return here && fraction != null ? { ...here, pct: Math.round(fraction * 1000) / 10 } : undefined;
  };

  const show = (place: RoomPlace | undefined) => {
    const target = view && place && resolvePlace(view, place);
    if (target) view!.show(target);
  };

  const directionNow = (places = snapshot.places): Direction => {
    const theirs = state.targetId ? places[state.targetId] : undefined;
    const here = view?.read();
    if (!view || !theirs || !here) return snapshot.direction;
    return returnDirection(view.fraction(here), view.fraction(theirs) ?? theirs.pct / 100);
  };

  const setState = (next: FollowState) => {
    if (next === state) return;
    const retargeted = next.targetId !== state.targetId;
    state = next;
    if (retargeted) o.updatePresence({ followingId: next.targetId });
    emit({ targetId: next.targetId, paused: next.paused, direction: next.paused ? directionNow() : snapshot.direction });
  };

  const moved = () => {
    const me = o.presence();
    const place = placeOf(view?.read());
    if (!me || !place) return;
    const pct = Math.round(place.pct);
    const section = sectionOf(place.locator);
    const now = Date.now();
    if (progressDue(progress, pct, section, now)) {
      progress = { pct, section, at: now };
      o.updatePresence({ progressPct: pct });
    }
    if (!sendsPos(me, roster)) sent = null;
    else if (placeKey(place) !== sent) {
      sent = placeKey(place);
      o.channel.send("pos", { from: o.readerId, ...place });
    }
    if (state.paused) emit({ direction: directionNow() });
  };

  const byHand = () => setState(nextFollow(state, { type: "scrolled" }));

  o.channel.on("pos", ({ from, ...place }) => {
    if (from === o.readerId) return;
    const places = { ...snapshot.places, [from]: place };
    if (from === state.targetId && !state.paused) show(place);
    emit({ places, direction: state.paused ? directionNow(places) : snapshot.direction });
  });

  o.channel.on("summon", (event) => {
    // Moderators made after you joined are in the roster, not in moderatorIds.
    const moderatorIds = [...o.moderatorIds, ...roster.filter((p) => p.isModerator).map((p) => p.readerId)];
    if (event.from === o.readerId || !acceptSummon(event, moderatorIds)) return;
    const { from, ...place } = event;
    // Everyone follows them from here (spec §9); outside the reader, the
    // follow takes you there when you open the book.
    emit({ places: { ...snapshot.places, [from]: place } });
    setState(nextFollow(state, { type: "summoned", from }));
    show(place);
  });

  o.signal.addEventListener("abort", () => {
    clearTimeout(settle);
    detachView?.abort();
  });

  return {
    setView(next) {
      detachView?.abort();
      detachView = null;
      clearTimeout(settle);
      view = next && next.materialId === o.roomMaterialId ? next : null;
      o.updatePresence({ inReader: view !== null, mode: view?.mode ?? "read" });
      if (!view || o.signal.aborted) return;
      detachView = new AbortController();
      const options = { capture: true, passive: true, signal: detachView.signal };
      view.root.addEventListener(
        "scroll",
        () => {
          clearTimeout(settle);
          settle = setTimeout(moved, SETTLE_MS);
        },
        options,
      );
      // Only a hand on the text pauses following; our own scrolls don't.
      view.root.addEventListener("wheel", byHand, options);
      view.root.addEventListener("touchmove", byHand, options);
      window.addEventListener(
        "keydown",
        (e) => {
          const target = e.target as HTMLElement | null;
          if (NAV_KEYS.has(e.key) && !target?.closest("input, textarea, select, [contenteditable]")) byHand();
        },
        { signal: detachView.signal },
      );
      moved();
      if (state.targetId && !state.paused) show(snapshot.places[state.targetId]);
    },

    setRoster(next) {
      roster = next;
      const ids = next.map((p) => p.readerId);
      setState(nextFollow(state, { type: "roster", readerIds: ids }));
      const places = Object.fromEntries(Object.entries(snapshot.places).filter(([id]) => ids.includes(id)));
      if (Object.keys(places).length !== Object.keys(snapshot.places).length) emit({ places });
      // A new follower or a new member needs your place now (their margin,
      // their follow), not at your next scroll; `pos` is otherwise sent only
      // on change.
      const followers = new Set(next.filter((p) => p.followingId === o.readerId).map((p) => p.readerId));
      const gained = [...followers].some((id) => !followerIds.has(id)) || ids.some((id) => !memberIds.has(id));
      followerIds = followers;
      memberIds = new Set(ids);
      if (gained) {
        sent = null;
        moved();
      }
    },

    moved,

    follow(readerId) {
      if (readerId === o.readerId) return;
      setState(nextFollow(state, { type: "tap", readerId }));
      if (state.targetId === readerId) show(snapshot.places[readerId]);
    },

    unfollow: () => setState(nextFollow(state, { type: "stop" })),

    returnToFollowed() {
      setState(nextFollow(state, { type: "return" }));
      if (state.targetId) show(snapshot.places[state.targetId]);
    },

    summonEveryone() {
      const place = placeOf(view?.read());
      if (!place) return false;
      o.channel.send("summon", { from: o.readerId, ...place });
      return true;
    },

    close() {
      clearTimeout(settle);
      detachView?.abort();
    },
  };
}
