import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, CircleDashed, Library, Send, Users } from "lucide-react";
import AdminPageHeader from "./AdminPageHeader";
import ActivityChart from "./ActivityChart";
import InfoTip from "./InfoTip";
import { TARGETS, getDashboardMetrics, growthRate, ratio } from "@/lib/metrics/dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const formatCount = (n: number) => (n < 10_000 ? n.toLocaleString("en") : compact.format(n));
const formatPercent = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

// "This week" is the UTC day today and the 6 before it; "last week" the 7
// before that — the same bounds admin_dashboard_metrics() counts over.
const rangeFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const DAY_MS = 86_400_000;
function weekRanges(): string {
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const range = (endDaysAgo: number) =>
    rangeFormat.formatRange(new Date(today - (endDaysAgo + 6) * DAY_MS), new Date(today - endDaysAgo * DAY_MS));
  return `${range(0)} vs. ${range(7)}`;
}

type Goal = { met: boolean | null; text: string };

/** Judge `value` against `target`; null (no data or no baseline) stays unjudged. */
const goal = (value: number | null, target: number, text: string): Goal => ({
  met: value === null ? null : value >= target,
  text,
});
const growthGoalText = `+${Math.round(TARGETS.weeklyGrowth * 100)}% vs last week`;
const shareGoalText = (target: number) => `${Math.round(target * 100)}% or more`;

export default async function AdminDashboardPage() {
  const { totals, engagement: e, daily } = await getDashboardMetrics();

  const core = [
    { label: "Members", key: "members", info: "Everyone who has created an account, since launch." },
    { label: "Books", key: "books", info: "Every item in the library, including members' private uploads, not just public books." },
    { label: "Posts", key: "posts", info: "Every post members have written in the community feed, since launch." },
    { label: "Reactions", key: "reactions", info: "Every reaction members have left on posts, since launch." },
  ] as const;

  const newMembersChange = growthRate(totals.members_week, totals.members_prev_week);
  const wauChange = growthRate(e.wau, e.wau_prev);
  const monthlyActive = ratio(e.mau, totals.members);
  const stickiness = ratio(e.wau, e.mau);
  const activation = ratio(e.activated, e.recent_members);
  const retention = ratio(e.retained, e.cohort);
  const completion = ratio(e.finished, e.started);
  const contributors = ratio(e.contributors, e.wau);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <AdminPageHeader
        title="Dashboard"
        subtitle={weekRanges()}
        back={null}
        actions={
          <>
            <QuickAction href="/admin/library" icon={<Library size={14} />} label="Library" />
            <QuickAction href="/admin/readers" icon={<Users size={14} />} label="Readers" />
            <QuickAction href="/admin/push" icon={<Send size={14} />} label="Send" primary />
          </>
        }
      />

      <section aria-label="Core metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {core.map(({ label, key, info }) => (
          <Tile
            key={key}
            label={label}
            info={info}
            value={formatCount(totals[key])}
            detail={`+${formatCount(totals[`${key}_week`])} this week`}
            change={growthRate(totals[`${key}_week`], totals[`${key}_prev_week`])}
          />
        ))}
      </section>

      <section aria-labelledby="activity-heading" className="mt-3 rounded-sm border border-[var(--reader-border)] p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="activity-heading" className="m-0 text-[14px] font-bold text-[var(--reader-text)]">
            Reader activity
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--reader-text-muted)]">Active members per day · last 30 days</span>
            <InfoTip label="Reader activity">
              How many members used Ominira while signed in on each of the last 30 days. Each day also tracks members who read, new
              members, posts and reactions.
            </InfoTip>
          </div>
        </div>
        <ActivityChart data={daily} />
      </section>

      {/* One card divided into cells by hairlines — not bordered tiles nested
          inside a bordered section. Each cell draws its own right + bottom
          border; the grid overhangs by 1px so the outer edge's are clipped.
          (A gap-px backdrop drops lines at fractional column widths.) */}
      <section aria-labelledby="growth-heading" className="mt-3 overflow-hidden rounded-sm border border-[var(--reader-border)]">
        <h2 id="growth-heading" className="m-0 px-5 py-4 text-[14px] font-bold text-[var(--reader-text)]">
          Growth &amp; engagement
        </h2>
        <div className="-mr-px -mb-px grid grid-cols-2 border-t border-[var(--reader-border)] lg:grid-cols-4">
          <Tile
            cell
            label="New members"
            info="Members who created an account this week."
            value={formatCount(totals.members_week)}
            detail={`${formatCount(totals.members_prev_week)} last week`}
            change={newMembersChange}
            goal={goal(newMembersChange, TARGETS.weeklyGrowth, growthGoalText)}
          />
          <Tile
            cell
            label="Active this week"
            info="Members who used Ominira while signed in on at least one day this week. Any visit counts, whether reading, browsing or posting."
            value={formatCount(e.wau)}
            detail={`${formatCount(e.wau_prev)} last week`}
            change={wauChange}
            goal={goal(wauChange, TARGETS.weeklyGrowth, growthGoalText)}
          />
          <Tile
            cell
            label="Active this month"
            info="Members who used Ominira while signed in on at least one of the last 30 days, and what share of all members that is."
            value={formatCount(e.mau)}
            detail={`${formatPercent(monthlyActive)} of all ${formatCount(totals.members)} members`}
            goal={goal(monthlyActive, TARGETS.monthlyActive, `${shareGoalText(TARGETS.monthlyActive)} of members`)}
          />
          <Tile
            cell
            label="Stickiness"
            info="Active this week divided by active this month. Higher means members make Ominira a weekly habit rather than dropping in once in a while."
            value={formatPercent(stickiness)}
            detail="Of this month's active members, the share also active this week"
            goal={goal(stickiness, TARGETS.stickiness, shareGoalText(TARGETS.stickiness))}
          />
          <Tile
            cell
            label="Activation"
            info="Of the members who joined in the last 30 days, the share who have started at least one book, the first sign they found something worth reading."
            value={formatPercent(activation)}
            detail={`${e.activated} of ${e.recent_members} members who joined this month started a book`}
            goal={goal(activation, TARGETS.activation, shareGoalText(TARGETS.activation))}
          />
          <Tile
            cell
            label="Week-1 retention"
            info="Of the members who joined 8 to 14 days ago, the share who came back on any of the 7 days after they joined."
            value={formatPercent(retention)}
            detail={`${e.retained} of ${e.cohort} members who joined last week came back within 7 days`}
            goal={goal(retention, TARGETS.week1Retention, shareGoalText(TARGETS.week1Retention))}
          />
          <Tile
            cell
            label="Completion rate"
            info="Of every book any member has started, the share they've finished. Counted since launch, so it moves slowly."
            value={formatPercent(completion)}
            detail={`${formatCount(e.finished)} of ${formatCount(e.started)} books started have been finished`}
            goal={goal(completion, TARGETS.completion, shareGoalText(TARGETS.completion))}
          />
          <Tile
            cell
            label="Contributors"
            info="Of this week's active members, the share who wrote a post/note or left a reaction."
            value={formatPercent(contributors)}
            detail={`${e.contributors} of this week's active members posted or reacted`}
            goal={goal(contributors, TARGETS.contributors, shareGoalText(TARGETS.contributors))}
          />
        </div>
      </section>
    </div>
  );
}

function QuickAction({ href, icon, label, primary }: { href: string; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3.5 text-[12px] font-bold transition-colors ${
        primary
          ? "border-brand-500 bg-brand-500 text-white hover:border-brand-600 hover:bg-brand-600"
          : "border-[var(--reader-border)] text-[var(--reader-text)] hover:bg-[var(--reader-surface-hover)]"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

/**
 * One stat tile: label · value · detail line, plus an optional week-over-week
 * change. `goal` adds the benchmark the figure is judged against and the
 * verdict, with an icon + word so it never rests on color alone.
 */
function Tile({
  label,
  info,
  value,
  detail,
  change,
  goal,
  cell,
}: {
  label: string;
  info: string;
  value: string;
  detail: string;
  change?: number | null;
  goal?: Goal;
  /** A cell of a divided grid (no border of its own) rather than a standalone card. */
  cell?: boolean;
}) {
  const hasChange = change !== undefined && change !== null;

  return (
    <div
      className={`flex min-w-0 flex-col p-4 ${cell ? "border-r border-b border-[var(--reader-border)] shell:p-5" : "rounded-sm border border-[var(--reader-border)]"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold text-[var(--reader-text-muted)]">{label}</span>
        <InfoTip label={label}>{info}</InfoTip>
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[26px] font-literata font-semibold leading-tight tracking-tight text-[var(--reader-text)]">{value}</span>
        {hasChange && (
          <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-[var(--reader-text)]">
            {change >= 0 ? (
              <ArrowUpRight size={13} className="text-emerald-500" aria-hidden />
            ) : (
              <ArrowDownRight size={13} className="text-[var(--reader-accent)]" aria-hidden />
            )}
            {change >= 0 ? "+" : ""}
            {Math.round(change * 100)}%<span className="sr-only"> vs last week</span>
          </span>
        )}
      </div>
      <span className={`mt-1 text-[12px] font-medium leading-snug text-[var(--reader-text-muted)] ${goal ? "mb-3" : ""}`}>{detail}</span>
      {goal && (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] font-medium text-[var(--reader-text-muted)]">
          <span>Goal: {goal.text}</span>
          <span className="inline-flex items-center gap-1">
            {goal.met === null ? (
              <>
                <CircleDashed size={12} aria-hidden /> Not enough data
              </>
            ) : goal.met ? (
              <>
                <CircleCheck size={12} className="text-emerald-500" aria-hidden /> On target
              </>
            ) : (
              <>
                <CircleAlert size={12} className="text-[var(--reader-accent)]" aria-hidden /> Below target
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
