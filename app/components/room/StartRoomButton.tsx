"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AudioLines, Loader2 } from "lucide-react";
import Tooltip from "@/app/components/reader/Tooltip";
import { useIsAuthenticated } from "@/lib/auth/useIsAuthenticated";
import { materialKeys } from "@/lib/materials/queryKeys";
import { useMaterialRoom } from "@/lib/room/useMaterialRoom";
import { activeRoom, useRoomStore } from "@/stores/room-store";
import { showToast } from "@/stores/toast-store";

/** "Start a room" in the reader header (interim host: any signed-in reader,
 * public books only). On a book whose room is already live it joins that
 * room instead, as room-start does. Hidden while you're in this book's room. */
export default function StartRoomButton({ materialId, className }: { materialId: string; className: string }) {
  const signedIn = useIsAuthenticated();
  const { data } = useMaterialRoom(materialId);
  const inThisRoom = useRoomStore((s) => activeRoom(s)?.room.materialId === materialId);
  const start = useRoomStore((s) => s.start);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  if (!signedIn || !data?.canStart || inThisRoom) return null;
  const label = data.live ? "Join the room" : "Start a room";

  const onClick = async () => {
    setPending(true);
    try {
      await start(materialId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't open the room.");
    } finally {
      setPending(false);
      void queryClient.invalidateQueries({ queryKey: materialKeys.room(materialId) });
    }
  };

  return (
    <Tooltip label={label} side="bottom">
      <button onClick={onClick} disabled={pending} aria-label={label} className={className}>
        {pending ? <Loader2 size={16} className="animate-spin" /> : <AudioLines size={16} />}
      </button>
    </Tooltip>
  );
}
