"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useIsAuthenticated } from "@/lib/auth/useIsAuthenticated";
import { materialKeys } from "@/lib/materials/queryKeys";
import { useMaterialRoom } from "@/lib/room/useMaterialRoom";
import { activeRoom, useRoomStore } from "@/stores/room-store";
import { showToast } from "@/stores/toast-store";

/** "Live · 25 in room" on a book with a live room (spec §3.1, §11): tap to
 * join, or to open the panel when you're already in. A full room reads
 * "Full · 25 in room" and can't be joined. The one piece of the room in the
 * main bundle; joining loads the rest. */
export default function LiveChip({ materialId, className = "" }: { materialId: string; className?: string }) {
  const { data } = useMaterialRoom(materialId);
  const signedIn = useIsAuthenticated();
  const inRoomCount = useRoomStore((s) => {
    const room = activeRoom(s);
    return room?.room.materialId === materialId ? room.roster.length : null;
  });
  const join = useRoomStore((s) => s.join);
  const setPanelOpen = useRoomStore((s) => s.setPanelOpen);
  const queryClient = useQueryClient();

  const live = data?.live;
  if (!live) return null;
  const inRoom = inRoomCount !== null;
  const members = inRoom ? Math.max(inRoomCount, 1) : live.members;
  const full = !inRoom && members >= live.maxMembers;

  const onClick = async () => {
    if (inRoom) return setPanelOpen(true);
    if (!signedIn) return showToast("Sign in to join the room.");
    try {
      await join(live.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't join the room.");
      void queryClient.invalidateQueries({ queryKey: materialKeys.room(materialId) });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={full}
      title={inRoom ? "Open the room" : full ? "This room is full" : `Join ${live.title}`}
      className={`inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap transition-colors disabled:cursor-default ${
        full
          ? "bg-[var(--reader-surface-hover)] text-[var(--reader-text-muted)]"
          : "bg-[color-mix(in_srgb,var(--reader-accent)_12%,var(--reader-surface))] text-[var(--reader-accent)] hover:bg-[color-mix(in_srgb,var(--reader-accent)_20%,var(--reader-surface))]"
      } ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${full ? "bg-[var(--reader-text-muted)]" : "bg-brand-500"}`} />
      {full ? "Full" : "Live"} · {members} in room
    </button>
  );
}
