"use client";

import { useState } from "react";
import RoomEnded from "./RoomEnded";
import RoomMiniPlayer from "./RoomMiniPlayer";
import RoomPanel from "./RoomPanel";
import RoomStatsOverlay, { roomDebugEnabled } from "./RoomStatsOverlay";
import RoomText from "./RoomText";
import { useReaderView, useRoom } from "@/lib/room/hooks";
import { useRoomStore } from "@/stores/room-store";

/** Everything the room shows in the app shell, loaded by RoomLayer, and over
 * the book's reader while it's open (RoomText). Once the room ends, only the
 * ended screen; in a tab that yielded to another, only the mini-player. */
export default function RoomUI() {
  const panelOpen = useRoomStore((s) => s.panelOpen);
  const ended = useRoom((s) => s.ended !== null);
  const elsewhere = useRoom((s) => s.elsewhere);
  const view = useReaderView();
  const [debug] = useState(roomDebugEnabled);
  if (ended) return <RoomEnded />;
  return (
    <>
      {view && !elsewhere && <RoomText view={view} />}
      <RoomMiniPlayer />
      {panelOpen && !elsewhere && <RoomPanel />}
      {debug && !elsewhere && <RoomStatsOverlay />}
    </>
  );
}
