import type { Metadata } from "next";
import UnlockForm from "./UnlockForm";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default async function AdminUnlockPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-xs rounded-lg border border-[var(--reader-border)] p-6">
        <p className="m-0 mb-2 text-[12px] font-semibold text-[var(--reader-accent)]">Admin</p>
        <h1 className="font-serif type-3 text-balance m-0 text-[var(--reader-text)]">Enter PIN</h1>
        <p className="m-0 mt-1 mb-5 text-[13px] text-[var(--reader-text-muted)]">This area is for Ominira admins.</p>
        <UnlockForm next={next ?? "/admin"} />
      </div>
    </div>
  );
}
