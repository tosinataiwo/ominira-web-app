"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useInRoom } from "@/lib/room/hooks";
import { useRoomStore } from "@/stores/room-store";
import { useSessionStore } from "@/stores/session-store";

// Mounted once in the root layout. The room's UI (mini-player, panel, ended
// screen) loads only once you're in a room, so none of it is in the main
// bundle (spec §0.7).
const RoomUI = dynamic(() => import("./RoomUI"), { ssr: false });

export default function RoomLayer() {
  const readerId = useSessionStore((s) => s.readerId);
  // A reload goes back into the room this tab was in, once we know who's
  // signed in.
  useEffect(() => {
    if (readerId) void useRoomStore.getState().resume();
  }, [readerId]);
  return useInRoom() ? <RoomUI /> : null;
}
