"use client";

import { ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatTimeAgo } from "@/lib/reader/timeAgo";
import { pseudonymToSlug } from "@/lib/reader/profileSlug";
import AdminPageHeader from "@/app/admin/AdminPageHeader";
import Switch from "@/app/components/shell/Switch";

export type AdminReaderRow = {
  id: string;
  pseudonym: string;
  fullName: string;
  email: string;
  uploadApproved: boolean;
  joinedAt: string;
  uploads: number;
};

type Filter = "all" | "approved" | "unapproved";

// Same input/select styling as LibraryAdminView's toolbar.
const searchInputClass =
  "w-full rounded-sm border border-sand-300 bg-[var(--reader-surface)] py-2.5 pl-8 pr-4 font-medium text-[13px] leading-5 text-[var(--reader-text)] outline-none transition-colors placeholder:text-sand-400 focus:border-brand-400";

export default function ReadersAdminView({ readers }: { readers: AdminReaderRow[] }) {
  const [items, setItems] = useState(readers);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approvedCount = items.filter((r) => r.uploadApproved).length;
  const q = query.trim().toLowerCase();
  const visible = items.filter(
    (r) =>
      (filter === "all" || r.uploadApproved === (filter === "approved")) &&
      (!q || r.pseudonym.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
  );

  const setApproved = async (id: string, uploadApproved: boolean) => {
    setSavingId(id);
    setError(null);
    setItems((current) => current.map((r) => (r.id === id ? { ...r, uploadApproved } : r)));
    try {
      const response = await fetch(`/api/admin/readers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadApproved }),
      });
      if (!response.ok) throw new Error();
    } catch {
      setItems((current) => current.map((r) => (r.id === id ? { ...r, uploadApproved: !uploadApproved } : r)));
      setError("We could not update that reader. Please try again.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div>
      <AdminPageHeader
        title="Readers"
        subtitle={`${items.length.toLocaleString("en")} readers · ${approvedCount.toLocaleString("en")} approved to upload`}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--reader-text-subtle)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pseudonym, name or email"
            aria-label="Search readers"
            className={searchInputClass}
          />
        </label>
        <label className="relative">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            aria-label="Filter by approval"
            className="cursor-pointer appearance-none rounded-sm border border-sand-300 bg-[var(--reader-surface)] py-2.5 pl-4 pr-10 font-medium text-[13px] leading-5 text-[var(--reader-text)] outline-none transition-colors focus:border-brand-400"
          >
            <option value="all">All readers</option>
            <option value="approved">Approved</option>
            <option value="unapproved">Not approved</option>
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute inset-y-0 right-3.5 my-auto text-sand-500" />
        </label>
      </div>

      {error && (
        <p role="status" className="m-0 mb-3 rounded-[var(--radius-sm)] bg-brand-500/10 px-3 py-2.5 text-[12px] font-semibold text-[var(--reader-text)]">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-sm border border-[var(--reader-border)]">
        {visible.length === 0 ? (
          <p className="m-0 px-5 py-10 text-center text-sm text-[var(--reader-text-muted)]">
            {items.length === 0 ? "No readers yet." : "Nothing matches that search."}
          </p>
        ) : (
          <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-[var(--reader-border)] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--reader-text-subtle)]">
                <th className="px-3 py-2.5 font-[inherit]">Pseudonym</th>
                <th className="px-3 py-2.5 font-[inherit]">Name</th>
                <th className="px-3 py-2.5 font-[inherit]">Email</th>
                <th className="px-3 py-2.5 text-right font-[inherit]">Uploads</th>
                <th className="px-3 py-2.5 font-[inherit]">Joined</th>
                <th className="px-3 py-2.5 font-[inherit]">Can upload</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((reader) => (
                <tr key={reader.id} className="border-b border-[var(--reader-border)] last:border-b-0 hover:bg-[var(--reader-surface-hover)]">
                  <td className="max-w-[180px] truncate px-3 py-2.5 align-middle">
                    <Link href={`/@${pseudonymToSlug(reader.pseudonym)}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--reader-text)] hover:underline">
                      {reader.pseudonym}
                    </Link>
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2.5 align-middle text-[var(--reader-text-muted)]">{reader.fullName || "—"}</td>
                  <td className="max-w-[240px] truncate px-3 py-2.5 align-middle text-[var(--reader-text-muted)]">{reader.email}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle tabular-nums text-[var(--reader-text-muted)]">{reader.uploads}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-middle text-[var(--reader-text-muted)]">
                    {formatTimeAgo(new Date(reader.joinedAt).getTime())}
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <Switch
                      checked={reader.uploadApproved}
                      disabled={savingId === reader.id}
                      onChange={(next) => void setApproved(reader.id, next)}
                      ariaLabel={`Allow ${reader.pseudonym} to upload books`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
