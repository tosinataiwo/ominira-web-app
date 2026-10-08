/** Chat's unread count, the same pill wherever it shows (the Room tab, the
 * chat row, the room button). Keyed by the count, so each new message pops
 * it again: the quiet "something was said", in place of a sound. */
export default function UnreadBadge({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      key={count}
      className={`reader-face-in flex h-[17px] min-w-[17px] flex-none items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] leading-none font-bold tabular-nums text-white ${className}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
