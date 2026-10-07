"use client";

import { useEffect, useState } from "react";
import type { RoomSession } from "@/lib/room/session";
import { useRoomStore } from "@/stores/room-store";

// Dev only (spec §8.10): `localStorage["ominira-room-debug"] = "1"`, then
// rejoin. Per peer: state, RTT, jitter, loss, relayed. getStats runs every
// 5 s, and only while this is on screen.

const POLL_MS = 5_000;

type Row = Awaited<ReturnType<RoomSession["peerStats"]>>[number];

export default function RoomStatsOverlay() {
  const session = useRoomStore((s) => s.session);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!session) return;
    let live = true;
    const poll = () => void session.peerStats().then((next) => live && setRows(next));
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [session]);

  return (
    <div className="pointer-events-none fixed top-2 left-2 z-[80] rounded-md bg-black/75 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-white">
      <div className="font-bold">room peers: {rows.length}</div>
      {rows.map((r) => (
        <div key={r.readerId}>
          {r.name.slice(0, 12)} · {r.state} · rtt {r.rttMs ?? "–"} ms · jitter {r.jitterMs ?? "–"} ms · lost {r.packetsLost}
          {r.relayed ? " · TURN" : ""}
        </div>
      ))}
    </div>
  );
}

export function roomDebugEnabled(): boolean {
  try {
    return localStorage.getItem("ominira-room-debug") === "1";
  } catch {
    return false;
  }
}
