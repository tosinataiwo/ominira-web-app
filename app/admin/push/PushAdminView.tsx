"use client";

import { useState } from "react";
import {
  ArrowRight,
  BellRing,
  CircleCheck,
  CornerUpLeft,
  ExternalLink,
  Inbox,
  Loader2,
  Mail,
  Megaphone,
  Pencil,
  Send,
  Smartphone,
} from "lucide-react";
import { formatTimeAgo } from "@/lib/reader/timeAgo";
import AdminPageHeader from "@/app/admin/AdminPageHeader";
import InfoTip from "@/app/admin/InfoTip";
import TextField from "@/app/components/auth/TextField";
import TextAreaField from "@/app/components/auth/TextAreaField";
import SelectField from "@/app/components/auth/SelectField";
import { ANNOUNCEMENT_FROM_ADDRESS } from "@/lib/email/announcement";
import AppIcon from "@/app/components/pwa/AppIcon";
import { APP_ICON } from "@/lib/config/brand-assets";
import DestinationPicker, {
  DEFAULT_DESTINATION,
  destinationFromUrl,
  destinationLabel,
  destinationUrl,
  isDestinationValid,
  type Destination,
} from "./DestinationPicker";

export type AdminBroadcastRow = {
  id: string;
  title: string;
  body: string;
  url: string;
  recipient_count: number;
  failure_count: number;
  channels: Channel[];
  email_recipient_count: number;
  email_failure_count: number;
  created_at: string;
};

type Channel = "push" | "email";
type Channels = Record<Channel, boolean>;
const DEFAULT_CHANNELS: Channels = { push: true, email: false };

// Mirrors BroadcastSchema in app/api/admin/push/broadcast/route.ts.
const TITLE_MAX = 120;
const BODY_MAX = 500;

const primaryButtonClass =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-brand-500 px-3.5 text-[12px] font-bold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50";

const n = (count: number) => count.toLocaleString("en");
const plural = (count: number, word: string, many = `${word}s`) => `${n(count)} ${count === 1 ? word : many}`;

export default function PushAdminView({
  broadcasts,
  audience,
  emailEnabled,
}: {
  broadcasts: AdminBroadcastRow[];
  audience: { members: number; devices: number; emailSubscribers: number };
  /** RESEND_API_KEY is set — otherwise the Email channel is shown disabled. */
  emailEnabled: boolean;
}) {
  const [items, setItems] = useState(() => broadcasts);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [destination, setDestination] = useState<Destination>(DEFAULT_DESTINATION);
  const [channels, setChannels] = useState<Channels>(DEFAULT_CHANNELS);
  // Compose → review (previews + send PIN) → send. Sending is only reachable
  // from the review step, so nothing goes out that wasn't previewed first.
  const [step, setStep] = useState<"compose" | "review">("compose");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<AdminBroadcastRow | null>(null);

  const trimmedUrl = destinationUrl(destination);
  const linkValid = isDestinationValid(destination);
  const hasChannel = channels.push || (channels.email && emailEnabled);
  const canReview = title.trim().length > 0 && body.trim().length > 0 && linkValid && hasChannel;
  const selectedChannels = (Object.keys(channels) as Channel[]).filter((c) => channels[c]);

  const edit = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setSent(null);
  };

  const goTo = (next: "compose" | "review") => {
    setStep(next);
    setPin("");
    setPinError(null);
    setError(null);
    setSent(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reuse = (item: AdminBroadcastRow) => {
    setTitle(item.title);
    setBody(item.body);
    setDestination(destinationFromUrl(item.url));
    setChannels({ push: item.channels.includes("push"), email: item.channels.includes("email") && emailEnabled });
    goTo("compose");
  };

  const onSend = async () => {
    setSending(true);
    setError(null);
    setPinError(null);
    try {
      const res = await fetch("/api/admin/push/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, url: trimmedUrl, channels: selectedChannels, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "pin") {
          setPin("");
          setPinError(data.error ?? "That send PIN isn't right.");
        } else {
          setError(data.error ?? "Could not send broadcast.");
        }
        return;
      }
      setItems((current) => [data.item, ...current]);
      setTitle("");
      setBody("");
      setDestination(DEFAULT_DESTINATION);
      setChannels(DEFAULT_CHANNELS);
      goTo("compose");
      setSent(data.item);
    } catch {
      setError("Network error — the broadcast may not have gone out. Check the history before retrying.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <AdminPageHeader
        title="Broadcast"
        subtitle="Send an announcement to members"
      />

      <Stepper step={step} />

      {sent && (
        <p
          role="status"
          className="m-0 mb-3 flex items-center gap-1.5 rounded-sm border border-[var(--reader-border)] px-4 py-3 text-[13px] font-semibold text-[var(--reader-text)]"
        >
          <CircleCheck size={15} className="flex-none text-emerald-500" aria-hidden />
          Sent. {deliverySummary(sent)}.
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        {step === "compose" ? (
          <section aria-labelledby="compose-heading" className="rounded-sm border border-[var(--reader-border)] p-5">
            <h2 id="compose-heading" className="m-0 mb-4 text-[14px] font-bold text-[var(--reader-text)]">
              Compose
            </h2>

            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (canReview) goTo("review");
              }}
            >
              <TextField
                label="Title"
                id="push-title"
                hint={`${title.length}/${TITLE_MAX}`}
                value={title}
                onChange={(e) => edit(setTitle)(e.target.value)}
                maxLength={TITLE_MAX}
                placeholder="New in the library"
              />

              <TextAreaField
                label="Message"
                id="push-body"
                hint={`${body.length}/${BODY_MAX}`}
                value={body}
                onChange={(e) => edit(setBody)(e.target.value)}
                maxLength={BODY_MAX}
                rows={4}
                placeholder="Keep it short — most devices show two or three lines before truncating."
              />

              <DestinationPicker value={destination} onChange={edit(setDestination)} />

              <div>
                <SelectField
                  label="Send via"
                  id="push-channels"
                  value={channels.push && channels.email ? "both" : channels.email ? "email" : "push"}
                  onChange={(e) =>
                    edit(setChannels)({ push: e.target.value !== "email", email: e.target.value !== "push" })
                  }
                  className="cursor-pointer"
                >
                  <option value="push">App notification</option>
                  <option value="email" disabled={!emailEnabled}>
                    Email
                  </option>
                  <option value="both" disabled={!emailEnabled}>
                    App notification and email
                  </option>
                </SelectField>
                {/* <p className="m-0 mt-1.5 text-xs font-medium text-[var(--reader-text-muted)]">
                  {emailEnabled
                    ? "App notifications reach every member; email only reaches members who opted in."
                    : "Email isn't set up yet: add RESEND_API_KEY to enable it."}
                </p> */}
              </div>

              <button type="submit" disabled={!canReview} className={`${primaryButtonClass} self-start`}>
                Preview
                <ArrowRight size={14} aria-hidden />
              </button>
            </form>
          </section>
        ) : (
          <section aria-labelledby="review-heading" className="rounded-sm border border-[var(--reader-border)] p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 id="review-heading" className="m-0 text-[14px] font-bold text-[var(--reader-text)]">
                Review before sending
              </h2>
              <button
                type="button"
                onClick={() => goTo("compose")}
                disabled={sending}
                className="inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[12px] font-semibold text-[var(--reader-text-muted)] hover:text-[var(--reader-text)] disabled:cursor-not-allowed"
              >
                <Pencil size={13} aria-hidden />
                Edit
              </button>
            </div>

            {channels.push && (
              <div className="mb-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="m-0 mb-2 text-[12px] font-semibold text-[var(--reader-text-muted)]">On devices</p>
                  <NotificationPreview title={title} body={body} />
                </div>
                <div>
                  <p className="m-0 mb-2 text-[12px] font-semibold text-[var(--reader-text-muted)]">In the Notifications feed</p>
                  <FeedPreview title={title} body={body} />
                </div>
              </div>
            )}
            {channels.email && (
              <div className="mb-4">
                <p className="m-0 mb-2 text-[12px] font-semibold text-[var(--reader-text-muted)]">By email</p>
                <EmailPreview title={title} body={body} withButton={destination.kind !== "none"} />
              </div>
            )}

            <dl className="m-0 mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-[var(--reader-border)] pt-4 text-[13px]">
              <dt className="font-semibold text-[var(--reader-text-muted)]">Opens</dt>
              <dd className="m-0 min-w-0">
                {destination.kind === "none" ? (
                  <span className="font-medium text-[var(--reader-text)]">Nothing, just the message</span>
                ) : (
                <a
                  href={trimmedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 font-medium text-[var(--reader-text)] underline decoration-[var(--reader-border)] underline-offset-2 hover:decoration-current"
                >
                  <span className="break-all">{destinationLabel(destination)}</span>
                  <ExternalLink size={12} className="flex-none" aria-hidden />
                  <span className="sr-only">(test in a new tab)</span>
                </a>
                )}
                {destination.kind === "page" && (
                  <span className="block break-all text-[12px] font-medium text-[var(--reader-text-subtle)]">{trimmedUrl}</span>
                )}
              </dd>
              <dt className="font-semibold text-[var(--reader-text-muted)]">Reaches</dt>
              <dd className="m-0 font-medium text-[var(--reader-text)]">
                <ul className="m-0 list-none p-0">
                  {channels.push && (
                    <li>
                      {audience.devices > 0 ? plural(audience.devices, "subscribed device") : "No subscribed devices (no pop-ups)"} ·{" "}
                      {plural(audience.members, "member")} in their feed
                    </li>
                  )}
                  {channels.email && (
                    <li>
                      {audience.emailSubscribers > 0
                        ? `${plural(audience.emailSubscribers, "inbox")}, from ${ANNOUNCEMENT_FROM_ADDRESS}`
                        : "No members have opted in to email yet (nobody will be emailed)"}
                    </li>
                  )}
                </ul>
              </dd>
            </dl>

            <form
              className="mt-5 rounded-sm border border-[var(--reader-border)] bg-[var(--reader-surface-hover)] p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (pin.trim() && !sending) onSend();
              }}
            >
              <div className="max-w-60">
                <TextField
                  label="Send PIN"
                  id="push-pin"
                  type="password"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    setPinError(null);
                  }}
                  autoComplete="off"
                  autoFocus
                  error={pinError ?? undefined}
                />
              </div>
              <p className="m-0 mt-2 text-[12px] font-medium leading-snug text-[var(--reader-text-muted)]">
                Only people trusted to message every member have this. Sending is immediate and can&apos;t be recalled.
              </p>
              {error && (
                <p role="alert" className="m-0 mt-2 text-[12px] font-semibold text-[var(--reader-accent)]">
                  {error}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button type="submit" disabled={!pin.trim() || sending} className={primaryButtonClass}>
                  {sending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Send size={14} aria-hidden />}
                  {sending ? "Sending…" : "Send to everyone"}
                </button>
                <button
                  type="button"
                  onClick={() => goTo("compose")}
                  disabled={sending}
                  className="inline-flex h-9 cursor-pointer items-center rounded-[var(--radius-sm)] border border-[var(--reader-border)] px-3.5 text-[12px] font-bold text-[var(--reader-text)] transition-colors hover:bg-[var(--reader-surface)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Back
                </button>
              </div>
            </form>
          </section>
        )}

        <aside className="flex flex-col gap-3">
          {step === "compose" && (
            <section aria-labelledby="preview-heading" className="rounded-sm border border-[var(--reader-border)] p-5">
              <h2 id="preview-heading" className="m-0 mb-3 text-[14px] font-bold text-[var(--reader-text)]">
                Live preview
              </h2>
              <NotificationPreview title={title} body={body} />
              <p className="m-0 mt-2 truncate text-[11px] font-medium text-[var(--reader-text-subtle)]">{destination.kind === "none" ? "Tapping opens Ominira" : `Tapping opens ${destinationLabel(destination)}`}</p>
            </section>
          )}

          <section aria-labelledby="audience-heading" className="rounded-sm border border-[var(--reader-border)] p-5">
            <h2 id="audience-heading" className="m-0 mb-3 text-[14px] font-bold text-[var(--reader-text)]">
              Audience
            </h2>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              <AudienceRow
                icon={<Smartphone size={14} aria-hidden />}
                label="Subscribed devices"
                value={audience.devices}
                info="Browsers and installed apps that allowed notifications — signed in or not. One member can have several devices. These get the pop-up; expired ones are pruned automatically when a send fails."
              />
              <AudienceRow
                icon={<Inbox size={14} aria-hidden />}
                label="Members"
                value={audience.members}
                info="Every account. Each gets the announcement in their Notifications feed, even if they never turned push on."
              />
              <AudienceRow
                icon={<Mail size={14} aria-hidden />}
                label="Email subscribers"
                value={audience.emailSubscribers}
                info="Members who turned on Email announcements in Account settings → Preferences. Off by default; every email has a one-click unsubscribe."
              />
            </ul>
          </section>
        </aside>
      </div>

      <section aria-labelledby="history-heading" className="mt-3 overflow-hidden rounded-sm border border-[var(--reader-border)]">
        <div className="flex items-baseline justify-between gap-2 px-5 py-4">
          <h2 id="history-heading" className="m-0 text-[14px] font-bold text-[var(--reader-text)]">
            History
          </h2>
          <span className="text-[12px] font-semibold text-[var(--reader-text-muted)]">Last {Math.min(items.length, 50)} sent</span>
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 border-t border-[var(--reader-border)] px-5 py-10 text-center">
            <BellRing size={20} className="text-[var(--reader-text-subtle)]" aria-hidden />
            <p className="m-0 text-[13px] font-medium text-[var(--reader-text-muted)]">No broadcasts sent yet.</p>
          </div>
        ) : (
          <ul className="m-0 list-none p-0">
            {items.map((item) => (
              <li key={item.id} className="border-t border-[var(--reader-border)] px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="m-0 min-w-0 text-[13px] font-semibold text-[var(--reader-text)]">{item.title}</p>
                  <time
                    dateTime={item.created_at}
                    title={new Date(item.created_at).toLocaleString("en")}
                    className="flex-none text-[12px] font-medium text-[var(--reader-text-subtle)]"
                  >
                    {formatTimeAgo(new Date(item.created_at).getTime())}
                  </time>
                </div>
                <p className="m-0 mt-1 text-[13px] leading-snug text-[var(--reader-text-muted)]">{item.body}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="m-0 min-w-0 text-[12px] font-medium text-[var(--reader-text-subtle)]">
                    {deliverySummary(item)}
                    {item.url && (
                      <>
                        {" "}
                        · <span className="break-all">{item.url}</span>
                      </>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => reuse(item)}
                    className="inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[12px] font-semibold text-[var(--reader-text-muted)] hover:text-[var(--reader-text)]"
                  >
                    <CornerUpLeft size={13} aria-hidden />
                    Reuse
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stepper({ step }: { step: "compose" | "review" }) {
  const steps = [
    { key: "compose", label: "Compose" },
    { key: "review", label: "Preview & send" },
  ] as const;
  return (
    <ol className="m-0 mb-3 flex list-none items-center gap-2 p-0 text-[12px] font-semibold">
      {steps.map((s, i) => {
        const current = s.key === step;
        const done = step === "review" && s.key === "compose";
        return (
          <li key={s.key} aria-current={current ? "step" : undefined} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden className="h-px w-6 bg-[var(--reader-border)]" />}
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                current
                  ? "bg-[var(--reader-text)] text-[var(--reader-surface)]"
                  : "border border-[var(--reader-border)] text-[var(--reader-text-muted)]"
              }`}
            >
              {done ? <CircleCheck size={12} aria-hidden /> : i + 1}
            </span>
            <span className={current ? "text-[var(--reader-text)]" : "text-[var(--reader-text-muted)]"}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Approximates what sw.js's showNotification renders — exact chrome varies by OS and browser. */
function NotificationPreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] p-3 shadow-sm">
      <AppIcon size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-[11px] font-medium text-[var(--reader-text-subtle)]">
          <span>Ominira</span>
          <span>now</span>
        </div>
        <p className="m-0 truncate text-[13px] font-semibold text-[var(--reader-text)]">{title.trim() || "Notification title"}</p>
        <p className="m-0 line-clamp-3 text-[12px] leading-snug text-[var(--reader-text-muted)]">
          {body.trim() || "Your message appears here."}
        </p>
      </div>
    </div>
  );
}

/** Approximates lib/email/announcement.ts's template, inside a mail-client frame. */
function EmailPreview({ title, body, withButton }: { title: string; body: string; withButton: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)]">
      <div className="border-b border-[var(--reader-border)] px-4 py-2.5 text-[12px] leading-relaxed">
        <p className="m-0 text-[var(--reader-text-muted)]">
          <span className="font-semibold text-[var(--reader-text)]">Ominira</span> &lt;{ANNOUNCEMENT_FROM_ADDRESS}&gt;
        </p>
        <p className="m-0 truncate font-semibold text-[var(--reader-text)]">{title.trim()}</p>
      </div>
      <div className="bg-[#f6f3ef] p-4">
        <div className="mx-auto max-w-[460px] rounded-md border border-[#e8e2da] bg-white p-5 text-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={APP_ICON} alt="" width={28} height={28} className="mb-3 size-7 rounded-md" />
          <p className="m-0 mb-2 font-serif text-[18px] font-semibold leading-snug text-[#1c1917]">{title.trim()}</p>
          <p className="m-0 mb-4 whitespace-pre-line text-[13px] leading-relaxed text-[#2b2622]">{body.trim()}</p>
          {withButton && (
            <span className="inline-block rounded-md bg-[#be400d] px-3.5 py-2 text-[12px] font-bold text-white">Open in Ominira</span>
          )}
        </div>
        <p className="m-0 mt-3 text-center text-[10px] text-[#8a817a]">Unsubscribe link included automatically</p>
      </div>
    </div>
  );
}

/** Mirrors a broadcast row in app/components/notifications/NotificationsView.tsx. */
function FeedPreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--reader-border)] bg-[color-mix(in_srgb,var(--reader-accent)_7%,transparent)] p-3">
      <span
        aria-hidden
        style={{ background: "var(--color-olive-500)" }}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-white"
      >
        <Megaphone size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13px] leading-[1.45] text-[var(--reader-text)]">{title.trim()}</span>
        <span className="line-clamp-2 font-serif text-[13px] italic leading-[1.6] text-[var(--reader-text-muted)]">{body.trim()}</span>
        <span className="text-[11px] font-semibold tracking-wide text-[var(--reader-text-subtle)]">just now</span>
      </span>
    </div>
  );
}

function deliverySummary(item: AdminBroadcastRow) {
  const parts: string[] = [];
  if (item.channels.includes("push")) {
    parts.push(
      item.recipient_count === 0
        ? "Push: no subscribed devices"
        : `Push: ${n(item.recipient_count - item.failure_count)} of ${plural(item.recipient_count, "device")}`
    );
  }
  if (item.channels.includes("email")) {
    parts.push(
      item.email_recipient_count === 0
        ? "Email: no opted-in members"
        : `Email: ${n(item.email_recipient_count - item.email_failure_count)} of ${plural(item.email_recipient_count, "inbox", "inboxes")}`
    );
  }
  return parts.join(" · ");
}

function AudienceRow({ icon, label, value, info }: { icon: React.ReactNode; label: string; value: number; info: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="text-[var(--reader-text-subtle)]">{icon}</span>
      <span className="flex-1 text-[13px] font-semibold text-[var(--reader-text-muted)]">{label}</span>
      <span className="font-serif text-[18px] font-semibold tabular-nums text-[var(--reader-text)]">{n(value)}</span>
      <InfoTip label={label}>{info}</InfoTip>
    </li>
  );
}
