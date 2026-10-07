import type { RoomPresence } from "@/lib/room/events";

// The declarative mesh (spec §8.1, §8.3): a pure rule says which peers should
// exist, and a reconciler makes the open connections match it. Any order of
// presence events, duplicates and rejoins included, ends in the same set.
// Framework- and WebRTC-free: the Peer (peer.ts) comes in through `create`.

export type MeshMember = Pick<RoomPresence, "sessionId" | "sends">;

/** A pair connects iff at least one side sends, so listeners never connect
 * to each other and a room where nobody has spoken has no connections.
 * Takes the roster (one session per reader, presence.ts). */
export function desiredPeers<T extends MeshMember>(me: MeshMember, roster: readonly T[]): T[] {
  return roster.filter((p) => p.sessionId !== me.sessionId && (me.sends || p.sends));
}

export type MeshPeer = { close(): void };

export type Mesh<P extends MeshPeer> = {
  /** The latest presence; one reconcile pass per microtask, however many
   * updates arrive in it. */
  update(me: MeshMember, roster: readonly RoomPresence[]): void;
  /** A peer that closed itself (failed for good, spec §8.8). Dropped
   * without closing it again; the next pass rebuilds it if still desired. */
  forget(sessionId: string, peer: P): void;
  /** Open peers by remote sessionId, for the mic (replaceTrack) and playback. */
  readonly peers: ReadonlyMap<string, P>;
  /** Closes every peer; later updates do nothing. */
  close(): void;
};

export function createMesh<P extends MeshPeer>(options: { create: (remote: RoomPresence) => P }): Mesh<P> {
  const peers = new Map<string, P>();
  let me: MeshMember | null = null;
  let roster: readonly RoomPresence[] = [];
  let queued = false;
  let closed = false;

  const schedule = () => {
    if (queued || closed) return;
    queued = true;
    queueMicrotask(reconcile);
  };

  // Idempotent: run it twice on the same presence and the second pass does nothing.
  function reconcile() {
    queued = false;
    if (closed || !me) return;
    const desired = new Map(desiredPeers(me, roster).map((p) => [p.sessionId, p]));
    for (const [sessionId, peer] of peers) {
      if (desired.has(sessionId)) continue;
      peers.delete(sessionId);
      peer.close();
    }
    for (const [sessionId, remote] of desired) {
      if (!peers.has(sessionId)) peers.set(sessionId, options.create(remote));
    }
  }

  return {
    update(nextMe, nextRoster) {
      me = nextMe;
      roster = nextRoster;
      schedule();
    },
    forget(sessionId, peer) {
      if (peers.get(sessionId) !== peer) return;
      peers.delete(sessionId);
      schedule();
    },
    peers,
    close() {
      closed = true;
      for (const peer of peers.values()) peer.close();
      peers.clear();
    },
  };
}
