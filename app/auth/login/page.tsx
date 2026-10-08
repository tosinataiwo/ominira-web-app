"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Wordmark from "@/app/components/auth/Wordmark";
import SplashArtwork from "@/app/components/pwa/SplashArtwork";
import AuthButton from "@/app/components/auth/AuthButton";
import BackArrow from "@/app/components/auth/BackArrow";
import TextField from "@/app/components/auth/TextField";
import PasswordField from "@/app/components/auth/PasswordField";
import { useLogin } from "@/lib/auth/useLogin";
import { onboardingRoute } from "@/lib/auth/onboardingRoute";
import { errorMessage } from "@/lib/api/client";

function QuotePanel({ className = "" }: { className?: string }) {
  const router = useRouter();
  return (
    <div className={`flex flex-col bg-[var(--reader-bg)] px-6 py-10 text-white shell:px-10 shell:py-14 ${className}`}>
      {/* Same BackArrow as the signup/survey wizard's own StepHeader — login
          is the one auth screen a reader can also land on directly (its own
          link on the home feed/sidebar), but it should still feel like a
          step they can back out of, not a dead end. Goes to "/" (redirects
          to /home) rather than router.back(), same reasoning as signup's
          own first-step back: a direct/bookmarked visit has no in-app
          history to pop to. */}
      <div className="flex items-center gap-3">
        <BackArrow onClick={() => router.push("/")} className="-ml-2" />
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

function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  return (
    <div className="w-full max-w-sm">
      <h1 className="font-serif type-1 text-balance text-[var(--reader-text)]">Welcome back.</h1>
      <p className="mt-2 text-[14px] font-medium text-[var(--reader-text-muted)]">Log in to continue your journey of consciousness.</p>

      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate(
            { email, password },
            { onSuccess: ({ reader }) => router.push(onboardingRoute(reader)) }
          );
        }}
      >
        {/* Deliberately generic (no field) — api-spec.md: login's 401 can't
            point at one specific input without letting the response be used
            to enumerate registered emails. Rendered as a banner above the
            fields instead, still without navigating away. */}
        {errorMessage(login.error) && (
          <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-500">
            {errorMessage(login.error)}
          </p>
        )}
        <TextField
          label="Email"
          name="email"
          type="email"
          placeholder="e.g. ama@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div>
          <PasswordField
            label="Password"
            name="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="mt-2 text-right">
            <Link href="/auth/forgot-password" className="text-xs font-bold text-brand-500 no-underline">
              Forgot password?
            </Link>
          </div>
        </div>

        <AuthButton type="submit" disabled={login.isPending}>
          {login.isPending ? "Logging in…" : "Log in"}
        </AuthButton>
      </form>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--reader-border)]" />
        <span className="text-xs font-medium text-[var(--reader-text-muted)]">or</span>
        <div className="h-px flex-1 bg-[var(--reader-border)]" />
      </div>

      <p className="text-center text-[14px] text-[var(--reader-text-muted)]">
        New here?{" "}
        <Link href="/auth/signup" className="font-bold text-brand-500 no-underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <>
      {/* Mobile: quote hero stacked above the form, one scrollable page. */}
      <div className="shell:hidden">
        <QuotePanel className="min-h-[46vh]" />
        <div className="flex justify-center px-6 py-10">
          <LoginForm />
        </div>
      </div>

      {/* Desktop: split panel — quote left, form right. */}
      <div className="hidden min-h-screen shell:flex">
        <QuotePanel className="w-[38%] flex-none" />
        <div className="flex flex-1 items-center justify-center bg-[var(--reader-bg)] px-12">
          <LoginForm />
        </div>
      </div>
    </>
  );
}
