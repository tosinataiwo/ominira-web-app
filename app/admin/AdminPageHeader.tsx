import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

/** The one page header every /admin screen uses — eyebrow link back up,
 * title, optional subtitle, optional actions on the right. */
export default function AdminPageHeader({
  title,
  subtitle,
  back = { href: "/admin", label: "Dashboard" },
  actions,
}: {
  title: string;
  subtitle?: string;
  back?: { href: string; label: string } | null;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back ? (
          <Link
            href={back.href}
            className="mb-2 inline-flex items-center gap-0.5 text-[12px] font-semibold text-[var(--reader-text-muted)] hover:text-[var(--reader-text)]"
          >
            <ChevronLeft size={14} />
            {back.label}
          </Link>
        ) : (
          <p className="mb-2 text-[12px] font-semibold text-[var(--reader-accent)]">Admin</p>
        )}
        <h1 className="font-serif type-3 text-balance m-0 text-[var(--reader-text)]">{title}</h1>
        {subtitle && <p className="m-0 mt-1 text-[13px] font-medium text-[var(--reader-text-muted)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
