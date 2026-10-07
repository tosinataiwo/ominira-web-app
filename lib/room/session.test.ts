import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { RoomChannel } from "./channel";
import type { RoomPresence } from "./events";
import { desiredPeers } from "./mesh";
import type { PeerOptions } from "./peer";
import { selectRoster } from "./presence";
import { RoomSession, type SessionDeps } from "./session";
import type { RoomJoinPayload } from "./types";

// RoomSession's core in Node (spec §8.10): several sessions on a fake
// Realtime hub that shuffles, duplicates, delays and drops presence syncs
// and broadcasts, with fake peers, mic and playback. However the events
// arrive, every session ends up with exactly the peers desiredPeers asks
// for, sending what it should.

/** Small seeded PRNG, so a failing seed can be replayed. */
function prng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FakeChannel = {
  readerId: string;
  tracked: RoomPresence | null;
  onRoster: (entries: RoomPresence[]) => void;
  handlers: Map<string, ((payload: never) => void)[]>;
  closed: boolean;
};

function createHub(random: () => number) {
  const channels = new Set<FakeChannel>();
  const state = () => [...channels].flatMap((c) => (c.tracked ? [c.tracked] : []));
  const later = (fn: () => void) => setTimeout(fn, Math.floor(random() * 25));

  /** A sync with the current full state to everyone: maybe dropped,
   * maybe twice, entries shuffled, possibly overtaken by a later one. */
  function chaoticSync() {
    const snapshot = state();
    for (const c of channels) {
      if (random() < 0.25) continue;
      const times = random() < 0.25 ? 2 : 1;
      for (let i = 0; i < times; i++) {
        const entries = [...snapshot].sort(() => random() - 0.5);
        if (random() < 0.2 && entries.length) entries.push(entries[0]);
        later(() => !c.closed && c.onRoster(entries));
      }
    }
  }

  const open: SessionDeps["openRoomChannel"] = ({ readerId, onRoster, onStatus }) => {
    const c: FakeChannel = { readerId, tracked: null, onRoster, handlers: new Map(), closed: false };
    channels.add(c);
    onStatus("connecting");
    later(() => !c.closed && onStatus("live"));
    const channel: RoomChannel = {
      send(event, payload) {
        for (const other of channels) {
          if (other === c) continue;
          const copies = random() < 0.25 ? 2 : 1;
          for (let i = 0; i < copies; i++) later(() => !other.closed && other.handlers.get(event)?.forEach((h) => h(payload as never)));
        }
        return true;
      },
      on(event, handler) {
        c.handlers.set(event, [...(c.handlers.get(event) ?? []), handler as never]);
        return () => {};
      },
      track(presence) {
        c.tracked = presence;
        chaoticSync();
      },
      readStatus: async () => "live",
      heartbeat: async () => true,
      async close() {
        c.closed = true;
        channels.delete(c);
        chaoticSync();
      },
    };
    return channel;
  };

  return {
    open,
    /** The true state, delivered to everyone in order: what Realtime converges to. */
    async settle() {
      await wait(60);
      for (const c of channels) c.onRoster(state());
      await wait(20);
    },
    roster: () => selectRoster(state()),
  };
}

type FakePeer = { remote: string; sends: boolean; track: unknown; closed: boolean };

function fakeDeps(hub: ReturnType<typeof createHub>, peers: FakePeer[]): SessionDeps {
  const payload = (roomId: string, readerId: string): RoomJoinPayload => ({
    room: {
      id: roomId,
      materialId: "book",
      title: "Room",
      bookTitle: "Book",
      bookAuthor: "Author",
      startedBy: "r0",
      startedAt: new Date().toISOString(),
      maxMembers: 25,
    },
    isModerator: readerId === "r0",
    me: { name: readerId, avatar: { color: null, url: null } },
    moderatorIds: ["r0"],
    iceServers: [],
    supabase: { url: "", key: "" },
  });
  return {
    api: {
      startRoom: async () => payload("room", "r0"),
      joinRoom: async () => payload("room", "?"),
      leaveRoom: async () => {},
      leaveRoomOnUnload: () => {},
      endRoom: async () => {},
    },
    openRoomChannel: hub.open,
    createPeer: (options: PeerOptions) => {
      const peer: FakePeer = { remote: options.remote, sends: options.sends, track: options.track, closed: false };
      peers.push(peer);
      queueMicrotask(() => options.onHealth("connected"));
      return {
        iceRestarts: 0,
        setSends: () => void (peer.sends = true),
        setTrack: (track) => void (peer.track = track),
        close: () => void (peer.closed = true),
        stats: async () => ({ state: "connected", rttMs: 1, jitterMs: 1, packetsLost: 0, relayed: false }),
      };
    },
    createMic: ({ onChange }) => {
      let state: "off" | "on" = "off";
      const track = { id: Math.random() };
      return {
        get state() {
          return state;
        },
        on: async () => {
          state = "on";
          onChange("on", track as never);
        },
        off: () => {
          state = "off";
          onChange("off", null);
        },
        close: () => {},
      };
    },
    createPlayback: () => ({
      add() {},
      remove() {},
      setLocal() {},
      levels: () => new Map(),
      resume: async () => {},
      suspended: false,
      close() {},
    }),
  };
}

beforeAll(() => {
  // The session listens for visibility and pagehide; Node has neither.
  Object.assign(globalThis, {
    window: new EventTarget(),
    document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
  });
});

afterAll(() => {
  Object.assign(globalThis, { window: undefined, document: undefined });
});

describe("RoomSession on a chaotic channel", () => {
  for (const seed of [1, 7, 42, 99, 2026]) {
    test(`converges to desiredPeers (seed ${seed})`, async () => {
      const random = prng(seed);
      const hub = createHub(random);
      const peers: FakePeer[][] = [];
      const sessions: RoomSession[] = [];
      const open = (readerId: string) => {
        const created: FakePeer[] = [];
        peers.push(created);
        const session = new RoomSession(readerId, async () => "token", {} as AudioContext, fakeDeps(hub, created));
        sessions.push(session);
        return session;
      };

      const [a, b, c, d, e] = ["r0", "r1", "r2", "r3", "r4"].map(open);
      await a.start("book");
      await Promise.all([b, c, d, e].map((s) => s.join("room")));
      await wait(10);
      await b.setMic(true);
      await c.setMic(true);
      c.setMic(false);
      d.raiseHand();
      await wait(15);
      await e.leave();
      const e2 = open("r4");
      await e2.join("room");
      const aTab2 = open("r0");
      await aTab2.join("room");
      await d.setMic(true);
      await hub.settle();

      let snapshots = sessions.map((s) => {
        let snap: Parameters<Parameters<RoomSession["subscribe"]>[0]>[0] = null;
        s.subscribe((x) => (snap = x))();
        return snap as Parameters<Parameters<RoomSession["subscribe"]>[0]>[0];
      });
      // The first tab of r0 yielded to the second; e left.
      expect(snapshots[0]?.elsewhere).toBe(true);
      expect(snapshots[4]).toBeNull();

      const roster = hub.roster();
      expect(roster.map((p) => p.readerId).sort()).toEqual(["r0", "r1", "r2", "r3", "r4"]);

      sessions.forEach((session, i) => {
        const snap = snapshots[i];
        if (!snap || snap.elsewhere) {
          // Gone or yielded: nothing left open.
          expect(peers[i].filter((p) => !p.closed)).toEqual([]);
          return;
        }
        const me = roster.find((p) => p.sessionId === snap.sessionId)!;
        expect(me).toBeDefined();
        expect(snap.roster.map((p) => p.sessionId).sort()).toEqual(roster.map((p) => p.sessionId).sort());
        const open = peers[i].filter((p) => !p.closed);
        expect(open.map((p) => p.remote).sort()).toEqual(desiredPeers(me, roster).map((p) => p.sessionId).sort());
        // One open peer per remote, sending iff this session has had its mic on.
        expect(new Set(open.map((p) => p.remote)).size).toBe(open.length);
        for (const p of open) expect(p.sends).toBe(me.sends);
        for (const p of open) expect(p.track !== null).toBe(me.micOnAt !== null);
      });

      // b, c and d have had their mic on; a listener pair (a's tab, e2) has no peer.
      const listeners = roster.filter((p) => !p.sends).map((p) => p.sessionId);
      expect(listeners.length).toBe(2);

      await Promise.all(sessions.map((s) => s.leave()));
      snapshots = [];
    });
  }
});
