"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Wordmark from "@/app/components/auth/Wordmark";
import SplashArtwork from "@/app/components/pwa/SplashArtwork";
import AuthButton from "@/app/components/auth/AuthButton";
import BackArrow from "@/app/components/auth/BackArrow";
import PasswordField from "@/app/components/auth/PasswordField";
import { useResetPassword } from "@/lib/auth/useResetPassword";
import { onboardingRoute } from "@/lib/auth/onboardingRoute";
import { errorMessage, fieldError } from "@/lib/api/client";

function QuotePanel({ className = "" }: { className?: string }) {
  const router = useRouter();
  return (
    <div className={`flex flex-col bg-[var(--reader-bg)] px-6 py-10 text-white shell:px-10 shell:py-14 ${className}`}>
      <div className="flex items-center gap-3">
        <BackArrow onClick={() => router.push("/auth/login")} className="-ml-2" />
        <div className="hidden shell:block">
          <Wordmark />
        </div>
      </div>
      <blockquote className="font-serif text-[20px] font-bold mt-6 text-[var(--reader-text)] shell:mt-10">
      What matters is not to know the world but to change it.
      </blockquote>
      <div className="mt-4 text-xs font-bold tracking-[0.1em] text-brand-400">— Frantz Fanon, Black Skin, White Masks</div>
      <div className="pt-10 shell:pt-15">
        <SplashArtwork showAccent={false} />
      </div>
    </div>
  );
}

// Supabase's reset-password email link lands here with the recovery
// session's tokens in the URL *hash* fragment (`#access_token=...
// &refresh_token=...&type=recovery`), not a query string — that's Supabase
// Auth's own convention, so it never reaches this page's server render, only
// the client after mount.
function readRecoveryTokens(): { accessToken: string; refreshToken: string } | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  // `undefined` (still reading) vs `null` (nothing found) vs the tokens
  // themselves — the hash fragment only exists client-side, so this can't be
  // read during Next's server render of this "use client" page without a
  // hydration mismatch; an effect syncs it in once mounted instead.
  const [tokens, setTokens] = useState<{ accessToken: string; refreshToken: string } | null | undefined>(undefined);
  const resetPassword = useResetPassword();

  useEffect(() => {
    // Syncing with the URL hash fragment, a genuinely browser-only external
    // source this component can't read during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTokens(readRecoveryTokens());
  }, []);

  // Still reading the hash on first render (undefined) — render nothing
  // rather than flash the "invalid link" state.
  if (tokens === undefined) return <div className="w-full max-w-sm" />;

  if (tokens === null) {
    return (
      <div className="w-full max-w-sm">
        <h1 className="font-serif type-1 text-balance text-[var(--reader-text)]">Link expired.</h1>
        <p className="mt-2 font-serif text-[14px] text-[var(--reader-text-muted)]">
          This password reset link is invalid or has expired. Request a new one to continue.
        </p>
        <Link href="/auth/forgot-password" className="mt-8 block">
          <AuthButton type="button">Request a new link</AuthButton>
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="font-serif type-1 text-balance text-[var(--reader-text)]">Set a new password.</h1>
      <p className="mt-2 font-serif text-[14px] text-[var(--reader-text-muted)]">Choose a new password for your account.</p>

      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          resetPassword.mutate(
            { ...tokens, password },
            { onSuccess: ({ reader }) => router.push(onboardingRoute(reader)) }
          );
        }}
      >
        {errorMessage(resetPassword.error) && (
          <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-500">
            {errorMessage(resetPassword.error)}
          </p>
        )}
        <PasswordField
          label="New password"
          name="password"
          placeholder="Enter a new password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldError(resetPassword.error, "password")}
        />

        <AuthButton type="submit" disabled={resetPassword.isPending}>
          {resetPassword.isPending ? "Saving…" : "Save new password"}
        </AuthButton>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <div className="shell:hidden">
        <QuotePanel className="min-h-[46vh]" />
        <div className="flex justify-center px-6 py-10">
          <ResetPasswordForm />
        </div>
      </div>

      <div className="hidden min-h-screen shell:flex">
        <QuotePanel className="w-[38%] flex-none" />
        <div className="flex flex-1 items-center justify-center bg-[var(--reader-bg)] px-12">
          <ResetPasswordForm />
        </div>
      </div>
    </>
  );
}
