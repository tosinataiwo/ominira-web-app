import { describe, expect, test } from "bun:test";
import type { RoomPresence } from "./events";
import { createMesh, desiredPeers } from "./mesh";

const member = (sessionId: string, sends = false): RoomPresence => ({
  readerId: `reader-${sessionId}`,
  sessionId,
  joinedAt: 1,
  name: sessionId,
  avatar: { color: null, url: null },
  isModerator: false,
  sends,
  micOnAt: null,
  handRaisedAt: null,
  followingId: null,
  progressPct: 0,
  mode: "read",
  inReader: true,
});

const ids = (list: { sessionId: string }[]) => list.map((p) => p.sessionId).sort();
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("desiredPeers", () => {
  const me = member("me");

  test("a room of listeners has no connections", () => {
    expect(desiredPeers(me, [me, member("a"), member("b")])).toEqual([]);
  });

  test("a listener connects to senders only", () => {
    expect(ids(desiredPeers(me, [me, member("a", true), member("b"), member("c", true)]))).toEqual(["a", "c"]);
  });

  test("a sender connects to everyone else", () => {
    const sender = member("me", true);
    expect(ids(desiredPeers(sender, [sender, member("a"), member("b", true)]))).toEqual(["a", "b"]);
  });

  test("never to itself", () => {
    const sender = member("me", true);
    expect(desiredPeers(sender, [sender])).toEqual([]);
  });
});

/** A mesh over fake peers that records every create and close. */
function fakeMesh() {
  const log: string[] = [];
  const mesh = createMesh({
    create: (remote) => {
      log.push(`+${remote.sessionId}`);
      return { id: remote.sessionId, close: () => log.push(`-${remote.sessionId}`) };
    },
  });
  return { mesh, log, open: () => [...mesh.peers.keys()].sort() };
}

describe("createMesh", () => {
  const me = member("me");
  const sendingMe = member("me", true);

  test("a burst of updates is one pass, on the latest presence", async () => {
    const { mesh, log, open } = fakeMesh();
    mesh.update(me, [me, member("a", true)]);
    mesh.update(me, [me, member("a", true), member("b", true)]);
    mesh.update(me, [me, member("b", true)]);
    expect(log).toEqual([]);
    await tick();
    expect(log).toEqual(["+b"]);
    expect(open()).toEqual(["b"]);
  });

  test("idempotent: the same presence again changes nothing", async () => {
    const { mesh, log } = fakeMesh();
    const roster = [me, member("a", true)];
    mesh.update(me, roster);
    await tick();
    mesh.update(me, roster);
    await tick();
    mesh.update(me, [...roster, member("a", true)]); // duplicated entry
    await tick();
    expect(log).toEqual(["+a"]);
  });

  test("shuffled orders converge to the same peers", async () => {
    const roster = [me, member("a", true), member("b"), member("c", true), member("d")];
    const results = [];
    for (const order of [roster, [...roster].reverse(), [roster[3], roster[0], roster[4], roster[1], roster[2]]]) {
      const { mesh, open } = fakeMesh();
      mesh.update(me, order);
      await tick();
      results.push(open());
    }
    expect(results).toEqual([["a", "c"], ["a", "c"], ["a", "c"]]);
  });

  test("starting to send connects to the listeners; peers already open stay", async () => {
    const { mesh, log, open } = fakeMesh();
    const roster = [me, member("a", true), member("b")];
    mesh.update(me, roster);
    await tick();
    mesh.update(sendingMe, [sendingMe, ...roster.slice(1)]);
    await tick();
    expect(log).toEqual(["+a", "+b"]);
    expect(open()).toEqual(["a", "b"]);
  });

  test("a member who leaves, or rejoins as a new session, is closed", async () => {
    const { mesh, log, open } = fakeMesh();
    mesh.update(sendingMe, [sendingMe, member("a"), member("b")]);
    await tick();
    mesh.update(sendingMe, [sendingMe, member("a2")]);
    await tick();
    expect(log).toEqual(["+a", "+b", "-a", "-b", "+a2"]);
    expect(open()).toEqual(["a2"]);
  });

  test("a peer that closed itself is rebuilt while still desired", async () => {
    const { mesh, log } = fakeMesh();
    mesh.update(me, [me, member("a", true)]);
    await tick();
    const failed = mesh.peers.get("a")!;
    mesh.forget("a", failed);
    await tick();
    expect(log).toEqual(["+a", "+a"]);
    expect(mesh.peers.get("a")).not.toBe(failed);
  });

  test("forgetting a peer that was already replaced does nothing", async () => {
    const { mesh, log } = fakeMesh();
    mesh.update(me, [me, member("a", true)]);
    await tick();
    const first = mesh.peers.get("a")!;
    mesh.forget("a", first);
    await tick();
    mesh.forget("a", first);
    await tick();
    expect(log).toEqual(["+a", "+a"]);
  });

  test("close closes every peer and ignores later updates", async () => {
    const { mesh, log, open } = fakeMesh();
    mesh.update(sendingMe, [sendingMe, member("a"), member("b")]);
    await tick();
    mesh.close();
    mesh.update(sendingMe, [sendingMe, member("c")]);
    await tick();
    expect(log).toEqual(["+a", "+b", "-a", "-b"]);
    expect(open()).toEqual([]);
  });

  test("an update queued before close never runs", async () => {
    const { mesh, log } = fakeMesh();
    mesh.update(me, [me, member("a", true)]);
    mesh.close();
    await tick();
    expect(log).toEqual([]);
  });
});
