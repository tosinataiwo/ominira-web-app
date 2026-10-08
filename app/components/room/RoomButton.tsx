"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MicVocal } from "lucide-react";
import { useIsAuthenticated } from "@/lib/auth/useIsAuthenticated";
import { materialKeys } from "@/lib/materials/queryKeys";
import { useMaterialRoom } from "@/lib/room/useMaterialRoom";
import { roomChatUnread, useRoomStore } from "@/stores/room-store";
import { showToast } from "@/stores/toast-store";
import UnreadBadge from "./UnreadBadge";

/** The book's room, as the notes rail shows it: whether you're in it, it's
 * live, or you could start one. Null when there's nothing to show. */
export function useRoomEntry(materialId: string) {
  const signedIn = useIsAuthenticated();
  const { data } = useMaterialRoom(materialId);
  const unread = useRoomStore((s) => roomChatUnread(s, materialId));
  if (unread !== null) return { state: "in" as const, unread };
  const live = data?.live;
  if (live) return { state: "live" as const, live, full: live.members >= live.maxMembers };
  if (signedIn && data?.canStart) return { state: "start" as const };
  return null;
}

/** The room's place on the notes rail — every way into the room lives on
 * the rail, so all of the book's social side is one button away. Starts a
 * room (interim host: any signed-in reader, public books only), joins the
 * one live on the book, or, once you're in, opens the feed on its Room tab,
 * carrying chat's unread count. A live dot whenever the room is on. */
export default function RoomButton({ materialId, onOpen }: { materialId: string; onOpen: () => void }) {
  const entry = useRoomEntry(materialId);
  const signedIn = useIsAuthenticated();
  const start = useRoomStore((s) => s.start);
  const join = useRoomStore((s) => s.join);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  if (!entry) return null;

  const label =
    entry.state === "in"
      ? entry.unread > 0
        ? `Open the room, ${entry.unread} unread`
        : "Open the room"
      : entry.state === "live"
        ? entry.full
          ? "This room is full"
          : `Join ${entry.live.title}`
        : "Start a room";

  const onClick = async () => {
    if (entry.state === "in") return onOpen();
    if (!signedIn) return showToast("Sign in to join the room.");
    setPending(true);
    try {
      if (entry.state === "live") await join(entry.live.id);
      else await start(materialId);
      onOpen();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't open the room.");
    } finally {
      setPending(false);
      void queryClient.invalidateQueries({ queryKey: materialKeys.room(materialId) });
    }
  };

  return (
    <button
      onClick={() => void onClick()}
      disabled={pending || (entry.state === "live" && entry.full)}
      aria-label={label}
      title={label}
      className="relative flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-full text-[var(--reader-text-muted)] transition-colors hover:bg-[var(--reader-surface-hover)] disabled:cursor-default disabled:opacity-60"
    >
      {pending ? <Loader2 size={20} className="animate-spin" /> : <MicVocal size={21} strokeWidth={2} />}
      {entry.state === "in" && entry.unread > 0 ? (
        <UnreadBadge count={entry.unread} className="absolute right-0 top-0.5 ring-2 ring-[var(--reader-surface)]" />
      ) : (
        entry.state !== "start" && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-[var(--reader-surface)]"
          />
        )
      )}
    </button>
  );
}
