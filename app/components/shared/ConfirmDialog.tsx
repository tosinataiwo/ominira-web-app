"use client";

import { useEffect, useRef } from "react";
import { useConfirmStore } from "@/stores/confirm-store";
import { useReaderStore } from "@/stores/reader-store";

/** Mounted once in the root layout: the dialog behind `confirmAction` —
 * a centered card over a dimmed backdrop, Cancel and the action side by
 * side. Escape and the backdrop cancel. Pinned to the app's theme, since
 * whatever asked may sit in a subtree that forces its own (the room's
 * mini-player, the now-playing bar). */
export default function ConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending);
  const settle = useConfirmStore((s) => s.settle);
  const theme = useReaderStore((s) => s.theme);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, settle]);

  if (!pending) return null;
  const { title, message, confirmLabel = "Yes", danger = false } = pending;

  return (
    <div
      data-reader-theme={theme}
      onClick={() => settle(false)}
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-6"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={message ? "confirm-message" : undefined}
        onClick={(e) => e.stopPropagation()}
        className="reader-menu-in flex w-full max-w-[360px] flex-col gap-5 rounded-lg bg-[var(--reader-surface)] p-5 shadow-lg"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="confirm-title" className="m-0 font-serif text-base font-semibold text-[var(--reader-text)]">
            {title}
          </h2>
          {message && (
            <p id="confirm-message" className="m-0 text-[13px] leading-relaxed text-[var(--reader-text-muted)]">
              {message}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(false)}
            className="h-9 cursor-pointer rounded-sm border border-[var(--reader-border)] bg-transparent px-4 text-[13px] font-bold text-[var(--reader-text)] transition-colors hover:bg-[var(--reader-surface-hover)]"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => settle(true)}
            className={`h-9 cursor-pointer rounded-sm border-none px-4 text-[13px] font-bold text-white transition-colors ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-brand-500 hover:bg-brand-600"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
