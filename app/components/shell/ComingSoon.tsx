// Shared placeholder for shell pages that aren't designed yet (Home, Notes,
// Profile) — exists so the nav has somewhere real to go rather than a dead
// link, without inventing a design for any of them ahead of that work.
export default function ComingSoon({ title }: { title: string }) {
  return (
    <div className="pb-10">
      <AppHeader />
      <h1 className="font-serif type-3 text-balance mt-1 mb-4 text-[var(--reader-text)]">{title}</h1>
      <p className="text-sm text-[var(--reader-text-muted)]">Coming soon.</p>
    </div>
  );
}
import AppHeader from "./AppHeader";
