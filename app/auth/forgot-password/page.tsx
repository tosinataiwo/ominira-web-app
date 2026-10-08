"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Wordmark from "@/app/components/auth/Wordmark";
import SplashArtwork from "@/app/components/pwa/SplashArtwork";
import AuthButton from "@/app/components/auth/AuthButton";
import BackArrow from "@/app/components/auth/BackArrow";
import TextField from "@/app/components/auth/TextField";
import { useForgotPassword } from "@/lib/auth/useForgotPassword";
import { errorMessage } from "@/lib/api/client";

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

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const forgotPassword = useForgotPassword();

  if (forgotPassword.isSuccess) {
    return (
      <div className="w-full max-w-sm">
        <h1 className="font-serif type-1 font-bold text-[var(--reader-text)]">Check your email.</h1>
        <p className="mt-2 text-[14px] font-medium text-[var(--reader-text-muted)]">
          {forgotPassword.data.message}
        </p>
        <p className="mt-8 text-center text-[14px] text-[var(--reader-text-muted)]">
          <Link href="/auth/login" className="font-bold text-brand-500 no-underline">
            Back to log in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="font-serif type-1 font-bold text-balance text-[var(--reader-text)]">Forgot your password?</h1>
      <p className="mt-2 text-[14px] font-medium text-[var(--reader-text-muted)]">
        Enter your email and we&apos;ll send you a link to reset it.
      </p>

      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          forgotPassword.mutate({ email });
        }}
      >
        {/* Deliberately generic (no field) — same enumeration-safe convention
            as login's own banner. */}
        {errorMessage(forgotPassword.error) && (
          <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-500">
            {errorMessage(forgotPassword.error)}
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

        <AuthButton type="submit" disabled={forgotPassword.isPending}>
          {forgotPassword.isPending ? "Sending…" : "Send reset link"}
        </AuthButton>
      </form>

      <p className="mt-6 text-center text-[14px] text-[var(--reader-text-muted)]">
        Remembered it?{" "}
        <Link href="/auth/login" className="font-bold text-brand-500 no-underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <>
      <div className="shell:hidden">
        <QuotePanel className="min-h-[46vh]" />
        <div className="flex justify-center px-6 py-10">
          <ForgotPasswordForm />
        </div>
      </div>

      <div className="hidden min-h-screen shell:flex">
        <QuotePanel className="w-[38%] flex-none" />
        <div className="flex flex-1 items-center justify-center bg-[var(--reader-bg)] px-12">
          <ForgotPasswordForm />
        </div>
      </div>
    </>
  );
}
