"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import ReaderAvatar from "@/app/components/shared/ReaderAvatar";
import { SPLASH_MARK } from "@/lib/config/brand-assets";
import { materialKeys } from "@/lib/materials/queryKeys";
import { comradeName } from "@/lib/reader/authorDisplay";
import { getRoomSummary } from "@/lib/room/api";
import { useRoom } from "@/lib/room/hooks";
import { formatDuration } from "@/lib/time/duration";
import { useReaderStore } from "@/stores/reader-store";
import { useRoomStore } from "@/stores/room-store";

// Room ended (spec §3.4, C6): full screen on mobile, a modal on desktop.
// Who joined and how long it was full; the next-session card arrives with
// the host hookup (Phase 5). Closing it is leaving the (ended) room.

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

export default function RoomEnded() {
  const theme = useReaderStore((s) => s.theme);
  const leave = useRoomStore((s) => s.leave);
  const room = useRoom((s) => s.room);
  const endedAt = useRoom((s) => s.ended?.endedAt);
  const { data: summary } = useQuery({
    queryKey: ["rooms", room?.id, "summary"],
    queryFn: () => getRoomSummary(room!.id),
    enabled: Boolean(room),
    staleTime: Infinity,
  });

  // The book's Live chip stops showing this room now, not on its next poll.
  const queryClient = useQueryClient();
  const materialId = room?.materialId;
  useEffect(() => {
    if (materialId) void queryClient.invalidateQueries({ queryKey: materialKeys.room(materialId) });
  }, [materialId, queryClient]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void leave();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave]);

  if (!room) return null;
  const ended = Date.parse(summary?.endedAt ?? endedAt ?? new Date().toISOString());
  const moderators = summary?.moderatorNames.map(comradeName).join(", ");
  const joined = summary?.joined;
  const fullFor = summary && summary.fullSeconds >= 60 ? ` · full for ${formatDuration(summary.fullSeconds * 1000)}` : "";

  return (
    <div
      data-reader-theme={theme}
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-ended-title"
      className="fixed inset-0 z-[70] flex items-stretch justify-center bg-[var(--reader-surface)] shell:items-center shell:bg-black/40"
    >
      <div className="flex w-full flex-col gap-6 overflow-y-auto bg-[var(--reader-surface)] px-5 pt-4 pb-7 shell:max-w-[560px] shell:rounded-lg shell:border shell:border-[var(--reader-border)] shell:shadow-lg">
        <div className="flex items-center justify-between">
          <button
            type="button"
            autoFocus
            onClick={() => void leave()}
            aria-label="Close"
            className="-ml-2 flex h-10 w-10 cursor-pointer items-center justify-center rounded-sm text-[var(--reader-text)] hover:bg-[var(--reader-surface-hover)]"
          >
            <X size={22} strokeWidth={1.75} />
          </button>
          <span className="text-xs font-medium text-[var(--reader-text-muted)]">
            Ended {clock.format(ended)} · {formatDuration(ended - Date.parse(room.startedAt))}
          </span>
        </div>

        <div className="flex flex-col items-center gap-2.5 text-center">
          {(["light", "dark"] as const).map((t) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={t} src={SPLASH_MARK[t]} alt="" aria-hidden="true" className={`theme-${t}-only h-auto w-32`} />
          ))}
          <h2 id="room-ended-title" className="font-serif type-1 font-bold text-[var(--reader-text)]">
            The room has ended.
          </h2>
          <p className="text-sm text-balance text-[var(--reader-text-muted)]">
            {room.title} ·
            {moderators ? ` Moderated by ${moderators}` : ""}
          </p>
        </div>

        {joined && (
          <div className="mx-auto flex w-full max-w-[520px] flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] font-semibold text-[var(--reader-text)]">Who joined</span>
              <span className="text-xs font-medium text-[var(--reader-text-muted)]">
                {joined.total} {joined.total === 1 ? "comrade" : "comrades"}
                {fullFor}
              </span>
            </div>
            <div className="flex items-center">
              {joined.first.map((r) => (
                <span key={r.readerId} title={comradeName(r.name)} className="-mr-2 rounded-full ring-2 ring-[var(--reader-surface)]">
                  <ReaderAvatar pseudonym={r.name} avatar={r.avatar} size={34} />
                </span>
              ))}
              {joined.total > joined.first.length && (
                <span className="ml-4 text-sm text-[var(--reader-text-muted)]">+{joined.total - joined.first.length}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
