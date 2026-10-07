import type { RoomChannel } from "@/lib/room/channel";
import type { RoomEvent } from "@/lib/room/events";
import type { MeshMember } from "@/lib/room/mesh";

// Addressed offer/answer over the channel's one `signal` event (spec §8.4).
// Media never depends on this: it only sets peers up and repairs them.
// Each remote session's signals go to its Peer (peer.ts) through `attach`.

export type Signal = RoomEvent<"signal">;
export type SignalHandler = (signal: Signal) => void;

/** Addressed to this session, from another session that's in the roster.
 * Anything else is stale (an old session) or forged (spec §8.9). */
export function acceptSignal(signal: Signal, sessionId: string, roster: readonly Pick<MeshMember, "sessionId">[]): boolean {
  return signal.to === sessionId && signal.from !== sessionId && roster.some((p) => p.sessionId === signal.from);
}

export type Signalling = {
  /** The roster `acceptSignal` checks against; drops held offers from
   * sessions no longer in it. */
  setRoster(roster: readonly Pick<MeshMember, "sessionId">[]): void;
  /** Routes a remote session's signals to its peer, first delivering an
   * offer that arrived before the peer existed. Returns the detach. */
  attach(remote: string, handler: SignalHandler): () => void;
  /** Holds an offer for the next peer attached for its sender: a peer that
   * can't apply an offer (the remote rebuilt its side) closes and hands it
   * to its replacement. */
  hold(signal: Signal): void;
  send(to: string, kind: Signal["kind"], sdp: Signal["sdp"]): void;
  close(): void;
};

export function createSignalling(options: { channel: Pick<RoomChannel, "send" | "on">; sessionId: string }): Signalling {
  const { channel, sessionId } = options;
  let roster: readonly Pick<MeshMember, "sessionId">[] = [];
  const handlers = new Map<string, SignalHandler>();
  // Presence reaches us 0.5–1.5 s late, so a new speaker's offer can beat
  // the presence that makes us want the peer. Keep the latest offer per
  // sender until the mesh creates it. An answer with no peer is meaningless.
  const heldOffers = new Map<string, Signal>();

  const off = channel.on("signal", (signal) => {
    if (!acceptSignal(signal, sessionId, roster)) return;
    const handler = handlers.get(signal.from);
    if (handler) handler(signal);
    else if (signal.sdp.type === "offer") heldOffers.set(signal.from, signal);
  });

  return {
    setRoster(next) {
      roster = next;
      for (const from of heldOffers.keys()) {
        if (!next.some((p) => p.sessionId === from)) heldOffers.delete(from);
      }
    },
    attach(remote, handler) {
      handlers.set(remote, handler);
      const held = heldOffers.get(remote);
      if (held) {
        heldOffers.delete(remote);
        handler(held);
      }
      return () => {
        if (handlers.get(remote) === handler) handlers.delete(remote);
      };
    },
    hold(signal) {
      if (signal.sdp.type === "offer") heldOffers.set(signal.from, signal);
    },
    send(to, kind, sdp) {
      channel.send("signal", { from: sessionId, to, kind, sdp });
    },
    close() {
      off();
      handlers.clear();
      heldOffers.clear();
    },
  };
}
