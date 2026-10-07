"use client";

import { useEffect, useRef, useState } from "react";
import PanelShell from "@/app/components/reader/notes/PanelShell";
import MicToggle from "./MicToggle";
import RoomAvatar from "./RoomAvatar";
import { comradeName } from "@/lib/reader/authorDisplay";
import { formatTimeAgo } from "@/lib/reader/timeAgo";
import { positionLabel } from "@/lib/room/follow";
import {
  useFollowing,
  useHands,
  useListening,
  usePlace,
  useReaderView,
  useRoom,
  useRoomControls,
  useSpeaking,
} from "@/lib/room/hooks";
import type { RoomPresence } from "@/lib/room/events";
import { formatDuration } from "@/lib/time/duration";
import { useNow } from "@/lib/time/useNow";
import { useReaderStore } from "@/stores/reader-store";
import { useRoomStore } from "@/stores/room-store";
import { showToast } from "@/stores/toast-store";

// The room panel (spec §3.3): a sheet on mobile, a right-hand panel on
// desktop, over whatever page you're on. Speaking now, Hands raised and
// Listening, with your mic in the footer, and End room for moderators
// (spec §12). No actions on anyone else's row; a tap on a face follows
// (spec §1.6). Moderators bring everyone to their page from below Speaking now.

export default function RoomPanel() {
  const theme = useReaderStore((s) => s.theme);
  const setPanelOpen = useRoomStore((s) => s.setPanelOpen);
  const panelSection = useRoomStore((s) => s.panelSection);
  const session = useRoomStore((s) => s.session);
  const view = useReaderView();
  const followingId = useFollowing()?.member.readerId;
  const room = useRoom((s) => s.room);
  const me = useRoom((s) => s.readerId);
  const count = useRoom((s) => s.roster.length) ?? 0;
  const moderators = useRoom((s) => s.roster.filter((p) => p.isModerator).map((p) => comradeName(p.name)));
  const controls = useRoomControls();
  const speaking = useSpeaking() ?? [];
  const hands = useHands() ?? [];
  const listening = useListening() ?? [];
  const now = useNow();
  const [ending, setEnding] = useState(false);
  const close = () => setPanelOpen(false);
  const listeningRef = useRef<HTMLElement>(null);

  // Opened from "N reading": straight to Listening.
  useEffect(() => {
    if (panelSection !== "listening") return;
    listeningRef.current?.scrollIntoView({ block: "start" });
    setPanelOpen(true);
  }, [panelSection, setPanelOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanelOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPanelOpen]);

  if (!room || !controls || !session) return null;
  const name = (p: RoomPresence) => `${comradeName(p.name)}${p.readerId === me ? " (you)" : ""}`;
  // A face follows, except your own.
  const avatar = (p: RoomPresence, size: number) => (
    <RoomAvatar
      member={p}
      size={size}
      pressed={p.readerId === followingId}
      onClick={p.readerId === me ? undefined : () => session.follow(p.readerId)}
    />
  );

  return (
    <div data-reader-theme={theme} className="pointer-events-none fixed inset-0 z-[60]">
      <PanelShell
        onClose={close}
        title={
          <span className="flex items-center gap-2 font-sans font-normal">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--reader-accent)_12%,var(--reader-surface))] px-2 py-0.5 text-[11px] font-bold tracking-wider text-[var(--reader-accent)] uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              Live
            </span>
            <span className="text-xs text-[var(--reader-text-muted)]">
              {count} in room · {formatDuration(now - Date.parse(room.startedAt))}
            </span>
          </span>
        }
        bodyClassName="om-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-5 pb-6 flex flex-col gap-6"
        footer={
          <div className="flex items-center justify-between gap-3">
            <MicToggle
              round
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border disabled:cursor-default disabled:opacity-50"
            />
            {controls.isModerator && (
              <button
                type="button"
                disabled={ending}
                onClick={() => {
                  if (!window.confirm("End the room for everyone?")) return;
                  setEnding(true);
                  session.end().catch(() => {
                    setEnding(false);
                    showToast("Couldn't end the room. Try again.");
                  });
                }}
                className="h-10 cursor-pointer rounded-md border border-[var(--reader-border)] px-4 text-sm font-semibold text-red-600 hover:bg-[var(--reader-surface-hover)] disabled:cursor-default disabled:opacity-50"
              >
                {ending ? "Ending…" : "End room"}
              </button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-1.5">
          <h2 className="font-serif text-xl leading-snug font-semibold text-[var(--reader-text)]">{room.title}</h2>
          <p className="text-sm text-[var(--reader-text-muted)]">
            {room.bookTitle} · {room.bookAuthor}
          </p>
          {moderators && moderators.length > 0 && (
            <p className="text-sm text-[var(--reader-text-muted)]">Moderated by {moderators.join(", ")}</p>
          )}
        </div>

        <Section title="Speaking now" count={speaking.length}>
          {speaking.length === 0 ? (
            <p className="text-sm text-[var(--reader-text-muted)]">Nobody&rsquo;s speaking.</p>
          ) : (
            speaking.map((p) => (
              <div
                key={p.readerId}
                className="flex items-center gap-3 rounded-md border border-[var(--reader-border)] py-2.5 pr-2 pl-3"
              >
                {avatar(p, 44)}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-bold text-[var(--reader-text)]">{name(p)}</span>
                  <SpeakerStatus member={p} />
                </div>
              </div>
            ))
          )}
          {controls.isModerator && (
            <button
              type="button"
              disabled={!view}
              title={view ? undefined : "Open the book to bring everyone to your page"}
              onClick={() => {
                if (session.summonEveryone()) showToast("Everyone's on their way to your page.");
              }}
              className="h-10 cursor-pointer self-start rounded-md border border-[var(--reader-border)] px-4 text-sm font-semibold text-[var(--reader-text)] hover:bg-[var(--reader-surface-hover)] disabled:cursor-default disabled:opacity-50"
            >
              Bring everyone to my page
            </button>
          )}
        </Section>

        {hands.length > 0 && (
          <Section title="Hands raised" count={hands.length} badge>
            {hands.map((p) => (
              <div key={p.readerId} className="flex items-center gap-3 py-1">
                {avatar(p, 40)}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-bold text-[var(--reader-text)]">{name(p)}</span>
                  <span className="text-xs text-[var(--reader-text-muted)]">{formatTimeAgo(p.handRaisedAt!, now)}</span>
                </div>
                {p.readerId === me && (
                  <button
                    type="button"
                    onClick={() => session.lowerHand()}
                    className="h-9 flex-none cursor-pointer rounded-md border border-[var(--reader-border)] px-3 text-sm font-semibold text-[var(--reader-text)] hover:bg-[var(--reader-surface-hover)]"
                  >
                    Lower
                  </button>
                )}
              </div>
            ))}
          </Section>
        )}

        <Section title="Listening" count={listening.length} sectionRef={listeningRef}>
          {count <= 1 ? (
            <p className="text-sm text-[var(--reader-text-muted)]">Waiting for comrades</p>
          ) : (
            <div className="grid grid-cols-6 gap-x-1.5 gap-y-3.5 shell:grid-cols-5">
              {listening.map((p) => (
                <div key={p.readerId} className="flex min-w-0 flex-col items-center gap-1.5">
                  {avatar(p, 40)}
                  <span className="max-w-full truncate text-xs text-[var(--reader-text-muted)]">
                    {p.readerId === me ? "You" : p.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </PanelShell>
    </div>
  );
}

/** "Moderator · speaking", or where they are: "On p. 4" (spec §3.3). */
function SpeakerStatus({ member }: { member: RoomPresence }) {
  const place = usePlace(member.readerId);
  const view = useReaderView();
  const position = member.isModerator ? null : positionLabel(member, place, view);
  return (
    <span className="truncate text-xs font-bold text-[var(--reader-accent)]">
      {member.isModerator ? "Moderator · speaking" : (position?.text ?? "Speaking")}
    </span>
  );
}

function Section({
  title,
  count,
  badge,
  sectionRef,
  children,
}: {
  title: string;
  count: number;
  /** Hands raised shows its count as a brand badge. */
  badge?: boolean;
  sectionRef?: React.Ref<HTMLElement>;
  children: React.ReactNode;
}) {
  return (
    <section ref={sectionRef} className="flex scroll-mt-4 flex-col gap-2">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--reader-text)]">
        {title}
        {badge ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-white">
            {count}
          </span>
        ) : (
          <span className="text-xs font-normal text-[var(--reader-text-muted)]">{count}</span>
        )}
      </h3>
      {children}
    </section>
  );
}
