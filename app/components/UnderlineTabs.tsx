"use client";

import type { ReactNode } from "react";

/**
 * Shared underline-tab bar: brand-colored active tab with a bottom border,
 * muted inactive tabs. Originally Shelf's reading/saved/finished switcher
 * (three views of one page, not a filter — hence tabs, not CategoryPills);
 * now also backs Home's popular/latest sort row, which used to be its own
 * plain text-link style before the two were unified.
 */
export default function UnderlineTabs<T extends string>({
  options,
  value,
  onChange,
  bare = false,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  /** Drops the bar's own baseline, for a container that draws it instead
   * (PanelShell's tab header) — the active tab's `-mb-px` underline then
   * lands on that container's border. */
  bare?: boolean;
}) {
  return (
    <div className={`flex gap-6 ${bare ? "" : "border-b border-[var(--reader-border)]"}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-current={value === option.value ? "page" : undefined}
          // Flex, so a label with a dot or badge in it centres on the same
          // line as a plain word instead of sitting on the dot's baseline.
          className={`-mb-px flex cursor-pointer items-center border-x-0 border-t-0 border-b-2 bg-transparent px-0.5 pb-2.5 text-[13px] font-bold transition-colors ${
            value === option.value
              ? "border-brand-500 text-brand-500"
              : "border-transparent text-[var(--reader-text-muted)] hover:text-[var(--reader-text)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
