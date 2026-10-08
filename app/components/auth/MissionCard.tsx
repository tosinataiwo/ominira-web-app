"use client";

import { forwardRef } from "react";
import { useRouter } from "next/navigation";
import AuthButton from "./AuthButton";

/**
 * Substack-style recruiting card: a plain bordered surface (not a dark photo
 * banner) with the pitch — title, subheading, CTAs — on the left and a
 * portrait + quote as the "illustration" on the right, the way Substack's
 * own house-ad card pairs a headline/CTA block with a decorative graphic in
 * the corner. Biko's photo is a thumbnail here rather than the full card
 * background, so it can sit beside the quote instead of behind it.
 *
 * Rather than a flat fill, the surface is a diagonal wash — the same
 * surface token warmed by brand rust via color-mix, stronger at one corner
 * and softer at the other but never fading back to plain surface, so the
 * tint reads across the full banner rather than pooling in one corner. No
 * pattern overlay or separate dark-mode variant needed — color-mix always
 * starts from --reader-surface, so it tracks whichever theme is active.
 */
const MissionCard = forwardRef<HTMLDivElement, { className?: string }>(function MissionCard(
  { className = "" },
  ref
) {
  const router = useRouter();

  return (
    <div
      ref={ref}
      className={`mb-15 relative overflow-hidden rounded-sm border border-[var(--reader-border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--reader-surface)_86%,var(--color-brand-500)_14%),color-mix(in_srgb,var(--reader-surface)_94%,var(--color-brand-500)_6%))] p-7 sm:p-9 ${className}`}
    >
      <div className="relative flex flex-col items-start gap-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col items-start gap-4">
          <div className="flex flex-col items-start gap-2">
            <h2 className="font-serif type-3 text-balance m-0 max-w-full text-[var(--reader-text)]">
              Online space for revolutionary Pan-Africanists to study as a collective.
            </h2>
            <p className="m-0 font-serif text-[13px] leading-snug text-[var(--reader-text-muted)] sm:text-sm">
              We are studying to change our world. Become a part of this project.
            </p>
          </div>

          {/* Side by side at every width, each sized to its own label rather
              than stretched full-width — two compact buttons read as a
              caption's CTAs, not a form. */}
          <div className="flex flex-row flex-wrap gap-3">
            <AuthButton variant="outline" fullWidth={false} onClick={() => router.push("/auth/login")}>
              Log in
            </AuthButton>
            <AuthButton variant="solid" fullWidth={false} onClick={() => router.push("/auth/signup")}>
              Join us
            </AuthButton>
          </div>
        </div>

        {/* The "illustration" corner: a portrait next to the quote it
            belongs to, wide enough for the line to breathe instead of
            wrapping into a narrow column. */}
        <div className="flex flex-none flex-row items-center gap-4 sm:max-w-80">
          <img
            src="https://zpkykgmtqzaglxbrwzah.supabase.co/storage/v1/object/public/public-cdn/rodney.jpeg"
            alt="Walter Rodney"
            className="h-20 w-20 flex-none object-cover object-[48%_20%] sm:h-24 sm:w-24"
          />
          <div>
            <blockquote className="m-0 font-serif italic text-[13px] font-semibold leading-snug text-[var(--reader-text)]">
              {/* &ldquo;The most potent weapon in the hands of the oppressor is the mind of the oppressed.&rdquo; */}
              &ldquo; Every African has a responsibility to understand the neocolonial system and work for its overthrow. &rdquo;
            </blockquote>
            <p className="m-0 mt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--reader-text-muted)]">
              Walter Rodney
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});

export default MissionCard;
