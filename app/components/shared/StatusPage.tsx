import type { ReactNode } from "react";
import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/config/platform";

/**
 * The one full-page "here's what happened" screen — 404s, error boundaries
 * and the unsubscribe flow all render through this, so a dead link reads the
 * same wherever it lands. Callers supply the wording (and any action, e.g. a
 * retry button or form); the way-home link is always there. No hooks, so it
 * works from both server pages and client error boundaries.
 */
export default function StatusPage({
  title,
  children,
  action,
  className = "min-h-screen",
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Height override — e.g. a boundary rendered inside a layout's chrome. */
  className?: string;
}) {
  return (
    <main
      className={`flex flex-col items-center justify-center gap-3 bg-[var(--reader-bg)] px-6 text-center ${className}`}
    >
      <h1 className="font-serif type-3 text-balance m-0 text-[var(--reader-text)]">{title}</h1>
      {children && <p className="m-0 max-w-sm text-sm text-[var(--reader-text-muted)]">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
      <Link
        href="/home"
        className="mt-2 text-[13px] font-semibold text-[var(--reader-text-muted)] hover:text-[var(--reader-text)]"
      >
        Go to {PLATFORM_NAME}
      </Link>
    </main>
  );
}

/** The primary button every StatusPage action uses. */
export const statusActionClass =
  "cursor-pointer rounded-[var(--radius-sm)] border-none bg-brand-500 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-brand-600";
