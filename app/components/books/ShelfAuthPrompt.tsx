"use client";

import { useRouter } from "next/navigation";
import { Lock, BookOpen } from "lucide-react";
import AuthButton from "@/app/components/auth/AuthButton";

/**
 * Shelf page's logged-out state. Used to just be MissionCard — the same
 * "join the movement" pitch (Biko portrait, quote, mission copy) the home
 * feed and AccountView show — which pitched the app in general rather than
 * what this particular page withholds: the reader's own list and how far
 * they got in each book.
 *
 * So instead this gates a preview of the real layout: a blurred stand-in
 * for the BookListRow grid sits in normal flow (giving the card its
 * height), with a lock + CTA overlaid on top. The emptiness itself becomes
 * "this is yours once you sign in" rather than a generic recruiting ad.
 * Placeholder rows use skeleton bars, not fabricated titles — same
 * loading-skeleton language ShelfView already uses for its authenticated
 * `isLoading` state, so nothing here could be mistaken for real data.
 */
const GHOST_ROWS = 4;

export default function ShelfAuthPrompt() {
  const router = useRouter();

  return (
    <div className="relative overflow-hidden rounded-sm border border-[var(--reader-border)]">
      <div
        aria-hidden="true"
        className="pointer-events-none grid select-none grid-cols-1 gap-x-10 px-6 py-2 opacity-60 blur-[3px] shell:grid-cols-2"
      >
        {Array.from({ length: GHOST_ROWS }).map((_, index) => (
          <div key={index} className="flex min-w-0 gap-4 border-b border-[var(--reader-border)] py-4">
            <div className="flex h-28 w-20 flex-none items-center justify-center rounded-xs bg-[var(--reader-surface-hover)]">
              <BookOpen size={22} strokeWidth={1.75} className="text-[var(--reader-text-muted)]" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
              <div className="h-3 w-3/4 rounded-full bg-[var(--reader-surface-hover)]" />
              <div className="h-2 w-2/5 rounded-full bg-[var(--reader-surface-hover)]" />
              <div className="h-1 w-1/2 rounded-full bg-[var(--reader-surface-hover)]" />
            </div>
          </div>
        ))}
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--reader-bg)_35%,transparent),var(--reader-bg)_70%)] px-6 py-10 text-center">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-[var(--reader-border)] bg-[var(--reader-surface)]">
          <Lock size={18} strokeWidth={1.75} className="text-brand-500" />
        </div>

        <div className="flex flex-col items-center gap-1.5">
          {/* <h2 className="font-serif type-3 text-balance m-0 text-[var(--reader-text)] sm:">
            Your reading list is waiting
          </h2> */}
          <p className="m-0 max-w-xs font-bold text-[14px] text-[var(--reader-text-muted)]">
            Continue right where you left off
          </p>
        </div>

        <div className="flex flex-row flex-wrap justify-center gap-3">
          <AuthButton variant="outline" fullWidth={false} onClick={() => router.push("/auth/login")}>
            Log in
          </AuthButton>
          <AuthButton variant="solid" fullWidth={false} onClick={() => router.push("/auth/signup")}>
            Join us
          </AuthButton>
        </div>
      </div>
    </div>
  );
}
