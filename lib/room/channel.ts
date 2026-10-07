import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  OPEN_GATE,
  RATE_LIMITS,
  gateFlush,
  gateOffer,
  parseEvent,
  parsePresence,
  type ClientEventName,
  type Gate,
  type RateLimit,
  type RoomEvent,
  type RoomEventName,
  type RoomPresence,
} from "@/lib/room/events";
import type { RoomJoinPayload } from "@/lib/room/types";

// The room's one private Realtime channel `room:{id}` (spec §6.2, §8.1), and
// the only place that calls channel.send. Typed by the event contract: sends
// pass through its rate limits, and received payloads and presence that
// don't match it are dropped.

/** `reconnecting`: supabase-js is rejoining on its own. */
export type ChannelStatus = "connecting" | "live" | "reconnecting";

export type RoomChannel = {
  /** False when the rate limit refused it (`chat`); held sends return true. */
  send<E extends ClientEventName>(event: E, payload: RoomEvent<E>): boolean;
  /** Returns the unsubscribe. */
  on<E extends RoomEventName>(event: E, handler: (payload: RoomEvent<E>) => void): () => void;
  /** Sent only when it differs from the last one; held until the channel is
   * live, and sent again after every rejoin. */
  track(presence: RoomPresence): void;
  /** `rooms.status`, for confirming `ended` (events.ts confirmEnded). */
  readStatus(): Promise<string | null>;
  /** The 30 s sign of life; false means aged out or ended, so rejoin. */
  heartbeat(): Promise<boolean>;
  close(): Promise<void>;
};

type Options = {
  join: RoomJoinPayload;
  readerId: string;
  /** The reader's current access token. supabase-js asks again on every
   * Realtime heartbeat and REST call, so a refreshed token is picked up
   * without watching the session store. */
  accessToken: () => Promise<string | null>;
  onRoster: (roster: RoomPresence[]) => void;
  onStatus: (status: ChannelStatus) => void;
};

/** Not back this long after a drop: give up on supabase-js's own rejoin and
 * start again on a fresh client; then retry at this pace until it's live. */
const REBUILD_MS = 8_000;

export function openRoomChannel(options: Options): RoomChannel {
  const { join, readerId, accessToken, onRoster, onStatus } = options;
  const roomId = join.room.id;

  let closed = false;
  let live = false;
  let tracked: RoomPresence | null = null;
  let trackedKey = "";
  const handlers = new Map<RoomEventName, Set<(payload: unknown) => void>>();
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  // supabase-js rejoins a dropped channel on its own, but with the token it
  // joined with: one that expired meanwhile (a laptop asleep) is refused,
  // and a channel the server closed is never rejoined. So a channel not back
  // within REBUILD_MS is replaced, client and socket too, on a fresh token.
  // Peers don't depend on the channel, so audio carries on meanwhile.
  let { supabase, channel } = openChannel();

  function openChannel() {
    // Its own client (the app has no browser Supabase client), gone with the
    // channel. The worker keeps the socket's heartbeat going in a hidden tab,
    // where timers are throttled and the server would drop it.
    const client = createClient<Database>(join.supabase.url, join.supabase.key, {
      accessToken,
      realtime: { worker: true },
    });
    // A replaced client's late callbacks are ignored.
    const current = () => !closed && client === supabase;
    const ch = client.channel(`room:${roomId}`, {
      config: { private: true, presence: { key: readerId } },
    });
    // Presence must be bound before subscribe, or the join doesn't enable it.
    ch.on("presence", { event: "sync" }, () => {
      if (!current()) return;
      const roster: RoomPresence[] = [];
      for (const entries of Object.values(ch.presenceState())) {
        for (const entry of entries) {
          const presence = parsePresence(entry);
          if (presence) roster.push(presence);
        }
      }
      onRoster(roster);
    });
    // One binding for every event, so a rebuilt channel needs no re-binding.
    ch.on("broadcast", { event: "*" }, ({ event, payload }) => {
      if (!current()) return;
      const name = event as RoomEventName;
      const listeners = handlers.get(name);
      if (!listeners?.size) return;
      const parsed = parseEvent(name, payload);
      if (parsed) for (const handler of listeners) handler(parsed);
    });
    // The token first: joining before it's set is refused as anonymous.
    void client.realtime.setAuth().then(() => {
      if (!current()) return;
      ch.subscribe((status) => {
        if (!current()) return;
        live = status === "SUBSCRIBED";
        if (live) {
          clearRebuild();
          // Every (re)join starts with no presence for us on the server.
          if (tracked) void ch.track(tracked);
        } else scheduleRebuild();
        onStatus(live ? "live" : "reconnecting");
      });
    });
    scheduleRebuild();
    return { supabase: client, channel: ch };
  }

  function scheduleRebuild() {
    if (rebuildTimer === null && !closed) rebuildTimer = setTimeout(rebuild, REBUILD_MS);
  }

  function clearRebuild() {
    if (rebuildTimer !== null) clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }

  function rebuild() {
    rebuildTimer = null;
    if (closed || live) return;
    const old = supabase;
    ({ supabase, channel } = openChannel());
    void old.removeAllChannels().catch(() => {});
  }

  // Back online, or back to the tab: don't wait out the timer.
  const wake = () => {
    if (closed || live || document.visibilityState !== "visible") return;
    clearRebuild();
    rebuild();
  };
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);

  onStatus("connecting");

  const gates = new Map<ClientEventName, Gate<unknown>>();
  const timers = new Map<ClientEventName, ReturnType<typeof setTimeout>>();

  // Over the socket once joined; before that (first join, rejoins) over REST,
  // said explicitly: supabase-js's implicit fallback is deprecated.
  const broadcast = (event: ClientEventName, payload: unknown) => {
    const sent = live
      ? channel.send({ type: "broadcast", event, payload })
      : channel.httpSend(event, payload);
    void sent.catch(() => {});
  };

  return {
    send(event, payload) {
      if (closed) return false;
      const limit = RATE_LIMITS[event] as RateLimit<unknown> | undefined;
      if (!limit) {
        broadcast(event, payload);
        return true;
      }
      const result = gateOffer(gates.get(event) ?? OPEN_GATE, payload, Date.now(), limit);
      gates.set(event, result.gate);
      if (result.send !== null) broadcast(event, result.send);
      if (result.flushInMs !== null && !timers.has(event)) {
        timers.set(
          event,
          setTimeout(() => {
            timers.delete(event);
            const flushed = gateFlush(gates.get(event) ?? OPEN_GATE, Date.now());
            gates.set(event, flushed.gate);
            if (flushed.send !== null && !closed) broadcast(event, flushed.send);
          }, result.flushInMs),
        );
      }
      return !result.dropped;
    },

    on(event, handler) {
      const listener = handler as (payload: unknown) => void;
      const listeners = handlers.get(event) ?? new Set();
      handlers.set(event, listeners);
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    track(presence) {
      const key = JSON.stringify(presence);
      if (closed || key === trackedKey) return;
      tracked = presence;
      trackedKey = key;
      if (live) void channel.track(presence);
    },

    async readStatus() {
      const { data } = await supabase.from("rooms").select("status").eq("id", roomId).maybeSingle();
      return data?.status ?? null;
    },

    async heartbeat() {
      const { data, error } = await supabase.rpc("room_heartbeat", { room: roomId });
      // A failed call isn't evidence the room is gone; the next beat retries.
      return error ? true : data === true;
    },

    async close() {
      if (closed) return;
      closed = true;
      clearRebuild();
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await supabase.removeAllChannels();
    },
  };
}
