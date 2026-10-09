"use client";

import { Hand, MessageCircle, ScreenShare } from "lucide-react";
import MicToggle from "./MicToggle";
import UnreadBadge from "./UnreadBadge";
import { ReactButton } from "./Reactions";
import { useReaderView, useRoom, useRoomControls } from "@/lib/room/hooks";
import { useRoomStore } from "@/stores/room-store";
import { showToast } from "@/stores/toast-store";

// Your mic, hand and reactions, in the mini-player: the chat (opening the
// Room tab, with your unread, while that tab isn't open), raising a hand and
// reacting first, quiet icon buttons (and, for a moderator in the book, Share screen:
// everyone follows them, spec §9), then a partition, then the mic, the one
// labelled control, only as wide as its label; centred in their row. The
// reactions tray opens centred over the row, so the card doesn't clip it.

const button =
  "flex h-11 flex-none items-center justify-center gap-2 rounded-full border px-3.5 text-[14px] font-bold whitespace-nowrap cursor-pointer transition-colors disabled:cursor-default disabled:opacity-50 shell:h-10";
const iconButton =
  "flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-full border transition-colors disabled:cursor-default disabled:opacity-50 shell:h-10 shell:w-10";

/** The Room tab's chat section, which the chat button scrolls to while the
 * panel is already open. */
export const ROOM_CHAT_ID = "room-chat";

/** The way into the room's chat — the Room tab — with your unread count;
 * also the minimised mini-player's way back to the full room. */
export function ChatButton({ onClick, className }: { onClick: () => void; className: string }) {
  const unread = useRoom((s) => s.chat.unread) ?? 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={unread > 0 ? `Open the chat, ${unread} unread` : "Open the chat"}
      title="Chat"
      className={`${className} relative ${
        unread > 0
          ? "border-[var(--reader-accent)] text-[var(--reader-accent)]"
          : "border-[var(--reader-border)] text-[var(--reader-text)]"
      } bg-[var(--reader-surface)]`}
    >
      <MessageCircle size={18} strokeWidth={1.75} />
      <UnreadBadge count={unread} className="absolute -top-1 -right-1 ring-2 ring-[var(--reader-surface)]" />
    </button>
  );
}

export default function RoomActions({ onChat }: { onChat?: () => void }) {
  const session = useRoomStore((s) => s.session);
  const controls = useRoomControls();
  const inReader = useReaderView() !== null;
  if (!controls || !session) return null;
  const { handRaised, connection, isModerator } = controls;

  return (
    // Wraps on narrow phones rather than running past the card's edges.
    <div className="relative flex min-w-0 flex-wrap items-center justify-center gap-2 shell:gap-3">
      {onChat && <ChatButton onClick={onChat} className={iconButton} />}
      <button
        type="button"
        disabled={connection === "connecting"}
        aria-pressed={handRaised}
        aria-label={handRaised ? "Lower your hand" : "Raise your hand"}
        title={handRaised ? "Lower hand" : "Raise hand"}
        onClick={() => (handRaised ? session.lowerHand() : session.raiseHand())}
        className={`${iconButton} ${
          handRaised
            ? "border-[var(--reader-accent)] bg-[color-mix(in_srgb,var(--reader-accent)_10%,var(--reader-surface))] text-[var(--reader-accent)]"
            : "border-[var(--reader-border)] bg-[var(--reader-surface)] text-[var(--reader-text)]"
        }`}
      >
        <Hand size={18} strokeWidth={1.75} />
      </button>
      <ReactButton className={iconButton} disabled={connection === "connecting"} />
      {isModerator && inReader && (
        <button
          type="button"
          disabled={connection === "connecting"}
          aria-label="Share screen"
          title="Share screen"
          onClick={() => {
            if (session.summonEveryone()) showToast("Everyone's reading along with you now.");
          }}
          className={`${iconButton} border-[var(--reader-border)] bg-[var(--reader-surface)] text-[var(--reader-text)]`}
        >
          <ScreenShare size={18} strokeWidth={1.75} />
        </button>
      )}
      <span aria-hidden="true" className="h-6 w-px flex-none bg-[var(--reader-border)]" />
      <MicToggle className={button} />
    </div>
  );
}
