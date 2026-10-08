"use client";

import { useState } from "react";
import RoomEnded from "./RoomEnded";
import RoomNarration from "./RoomNarration";
import RoomMiniPlayer from "./RoomMiniPlayer";
import RoomStatsOverlay, { roomDebugEnabled } from "./RoomStatsOverlay";
import RoomText from "./RoomText";
import { useReaderView, useRoom } from "@/lib/room/hooks";

/** Everything the room shows in the app shell, loaded by RoomLayer, and over
 * the book's reader while it's open (RoomText). Once the room ends, only the
 * ended screen; in a tab that yielded to another, only the mini-player. The
 * mini-player always shows: it holds the controls, and the book's Room tab
 * holds who's here and the chat. */
export default function RoomUI() {
  const ended = useRoom((s) => s.ended !== null);
  const elsewhere = useRoom((s) => s.elsewhere);
  const view = useReaderView();
  const [debug] = useState(roomDebugEnabled);
  if (ended) return <RoomEnded />;
  return (
    <>
      {view && !elsewhere && <RoomText view={view} />}
      <RoomMiniPlayer />
      <RoomNarration />
      {debug && !elsewhere && <RoomStatsOverlay />}
    </>
  );
}
