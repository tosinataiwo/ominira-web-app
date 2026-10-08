"use client";

import { useRouter } from "next/navigation";
import { useFeedStore } from "@/stores/feed-store";
import { useRoomStore } from "@/stores/room-store";
import { useReaderView } from "./hooks";

/** Expands the room: the book's feed panel on its Room tab. Away from the book (the room outlives the reader), it goes
 * back to the book first, where the panel opens as the reader loads. */
export function useOpenRoom() {
  const router = useRouter();
  const inReader = useReaderView() !== null;
  return (materialId: string) => {
    useFeedStore.getState().open(materialId, "room");
    if (inReader) return;
    const room = useRoomStore.getState().snapshot?.room;
    router.push(`/reader/${room?.materialId === materialId ? room.bookSlug : materialId}`);
  };
}
