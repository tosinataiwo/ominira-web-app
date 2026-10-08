"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getNames } from "country-list";
import Wordmark from "@/app/components/auth/Wordmark";
import AuthButton from "@/app/components/auth/AuthButton";
import BackArrow from "@/app/components/auth/BackArrow";
import TextField from "@/app/components/auth/TextField";
import PasswordField from "@/app/components/auth/PasswordField";
import SelectField from "@/app/components/auth/SelectField";
import NotePreviewCard from "@/app/components/auth/NotePreviewCard";
import { useSignup } from "@/lib/auth/useSignup";
import { useCheckAvailability } from "@/lib/auth/useCheckAvailability";
import { onboardingRoute } from "@/lib/auth/onboardingRoute";
import { ApiError, fieldError } from "@/lib/api/client";

// The old "A library. A space. A movement." / "What you get with Ominira"
// slides were dropped from this flow (both mobile and desktop) — they
// duplicated the marketing copy already on the pre-signup landing, adding
// two taps before a reader could even start the form.
const FORM_STEPS = ["form-account", "form-pseudonym", "form-location"] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COUNTRIES = [...getNames().sort((a, b) => a.localeCompare(b)), "Other"];

/** Continue's moderate desktop width (welcome screen's own button treatment) —
 * full-width stays on mobile, this just reins it in past the 860px split. */
const DESKTOP_AUTO_BUTTON = "shell:w-full shell:px-8";

function StepHeader({ formStepIndex, onBack }: { formStepIndex: number; onBack: () => void }) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3">
        <BackArrow onClick={onBack} className="-ml-2" />
        <div className="hidden shell:block">
          <Wordmark />
        </div>
      </div>
      <div className="mt-6 text-xs font-bold tracking-[0.1em] text-brand-500">
        STEP {formStepIndex + 1} OF {FORM_STEPS.length}
      </div>
    </div>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pseudonym, setPseudonym] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const signup = useSignup();

  const clampedStep = Math.min(step, FORM_STEPS.length - 1);
  const current = FORM_STEPS[clampedStep];

  // A field error can belong to an earlier step than the one the reader
  // submitted from (signup only actually posts once, from the last step) —
  // jump back to whichever step owns the offending field so the inline
  // error (rendered on that step's own TextField) is actually visible,
  // rather than a silent failure on the location step.
  const stepForField: Record<string, number> = {
    fullName: FORM_STEPS.indexOf("form-account"),
    email: FORM_STEPS.indexOf("form-account"),
    password: FORM_STEPS.indexOf("form-account"),
    pseudonym: FORM_STEPS.indexOf("form-pseudonym"),
  };

  // Each field is validated (format, then server-checked availability) as
  // the reader types, so "Continue" only ever advances once the step it's
  // leaving is actually complete and correct — no more discovering a taken
  // email/pseudonym only after filling out every later step too.
  const emailFormatValid = EMAIL_RE.test(email);
  const emailAvailability = useCheckAvailability("email", email, emailFormatValid);
  const emailAvailable = emailFormatValid && emailAvailability.available === true;

  const pseudonymFormatValid = pseudonym.trim().length > 0 && pseudonym.length <= 20;
  const pseudonymAvailability = useCheckAvailability("pseudonym", pseudonym, pseudonymFormatValid);
  const pseudonymAvailable = pseudonymFormatValid && pseudonymAvailability.available === true;

  const accountStepValid = fullName.trim().length > 0 && emailAvailable && password.length >= 8;
  const pseudonymStepValid = pseudonymAvailable;

  const emailError =
    fieldError(signup.error, "email") ??
    (email.length > 0 && !emailFormatValid
      ? "Enter a valid email address."
      : emailFormatValid && emailAvailability.available === false
      ? "This email is already registered."
      : undefined);
  const passwordError =
    fieldError(signup.error, "password") ??
    (password.length > 0 && password.length < 8 ? "Password must be at least 8 characters." : undefined);
  const pseudonymError =
    fieldError(signup.error, "pseudonym") ??
    (pseudonymFormatValid && pseudonymAvailability.available === false
      ? "That pseudonym is taken — try another."
      : undefined);

  const canContinue = current === "form-account" ? accountStepValid : current === "form-pseudonym" ? pseudonymStepValid : true;

  const goNext = () => {
    if (!canContinue) return;
    if (clampedStep === FORM_STEPS.length - 1) {
      signup.mutate(
        { fullName, email, password, pseudonym, city: city || undefined, country: country || undefined },
        {
          onSuccess: ({ reader }) => router.push(onboardingRoute(reader)),
          onError: (err) => {
            if (err instanceof ApiError && err.field && err.field in stepForField) {
              setStep(stepForField[err.field]);
            }
          },
        }
      );
    } else {
      setStep(clampedStep + 1);
    }
  };
  const goBack = () => {
    if (clampedStep === 0) {
      router.push("/");
    } else {
      setStep(clampedStep - 1);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--reader-bg)] px-6 py-8 shell:px-16 shell:py-16 xl:px-24">
      {/* Keep the progress marker and each step's introduction in the same
          left-hand column on desktop. The form occupies the right side,
          mirroring login's split desktop composition instead of centring the
          whole step independently beneath the page header. */}
      <div className="w-full shell:grid shell:grid-cols-[38%_minmax(0,1fr)] shell:gap-x-12">
        <div className="shell:col-span-2">
          <StepHeader formStepIndex={clampedStep} onBack={goBack} />
        </div>
        {current === "form-account" && (
          <div className="shell:contents">
            <div>
              <h1 className="font-serif type-1 text-balance text-[var(--reader-text)]">
                Let&rsquo;s get you started, <br></br> Comrade.
              </h1>
              <p className="mt-3 text-[14px] font-medium text-[var(--reader-text-muted)]">
                Enter your details below to create your account. <br></br> Use a fake identity if you have to.
              </p>
            </div>
            <div className="mt-8 w-full max-w-sm space-y-5 shell:mt-0 shell:justify-self-center">
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  goNext();
                }}
              >
                <TextField
                  label="Name"
                  placeholder="e.g. Ama Mensah"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  error={fieldError(signup.error, "fullName")}
                />
                <TextField
                  label="Email"
                  type="email"
                  placeholder="e.g. ama@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={emailError}
                  hint={emailAvailability.isChecking ? "Checking…" : undefined}
                />
                <PasswordField
                  label="Password"
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={passwordError}
                />
                <AuthButton type="submit" className={DESKTOP_AUTO_BUTTON} disabled={!accountStepValid}>
                  Continue
                </AuthButton>
              </form>
              <p className="hidden text-[14px] font-medium text-[var(--reader-text-muted)] shell:block">
                Already have an account?{" "}
                <Link href="/auth/login" className="font-bold text-brand-500 no-underline">
                  Log in
                </Link>
              </p>
            </div>
          </div>
        )}

        {current === "form-pseudonym" && (
          <div className="shell:contents">
            <h1 className="font-serif type-1 text-balance text-[var(--reader-text)]">
              Choose the name your comrades will know you by — this is what others see, never your full name.
            </h1>
            <div className="mt-8 w-full max-w-sm space-y-5 shell:mt-0 shell:justify-self-center">
              <TextField
                label="Pseudonym"
                placeholder="e.g. Kofi Writes"
                maxLength={20}
                hint={pseudonymAvailability.isChecking ? "Checking…" : `${pseudonym.length}/20`}
                value={pseudonym}
                onChange={(e) => setPseudonym(e.target.value)}
                error={pseudonymError}
              />
              <NotePreviewCard pseudonym={pseudonym} />
              <AuthButton className={DESKTOP_AUTO_BUTTON} onClick={goNext} disabled={!pseudonymStepValid}>
                Continue
              </AuthButton>
            </div>
          </div>
        )}

        {current === "form-location" && (
          <div className="shell:contents">
            <div>
              <h1 className="font-serif type-1 text-balance text-[var(--reader-text)]">
                Where are you studying from?
              </h1>
              <div className="mt-6 flex gap-3">
                <p className="text-[14px] font-medium leading-relaxed text-[var(--reader-text-muted)]">
                  We don&rsquo;t track your location. We only ask for your city and country so that we can show comrades that they&rsquo;re studying with other Africans from across the globe.
                </p>
              </div>
            </div>
            <div className="mt-8 w-full max-w-sm space-y-5 shell:mt-0 shell:justify-self-center">
              <TextField label="City" placeholder="e.g. Accra" value={city} onChange={(e) => setCity(e.target.value)} />
              <SelectField
                label="Country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                <option value="">Select your country</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </SelectField>
              {/* A non-field error (e.g. a network failure, or a 400 with
                  no field the server didn't attribute to one input) has
                  nowhere else to render — shown here since this is always
                  the step the reader is on when the request actually
                  fires. */}
              {signup.error && !(signup.error instanceof ApiError && signup.error.field) && (
                <p className="text-[13px] font-medium text-red-500">{signup.error.message}</p>
              )}
              <AuthButton className={DESKTOP_AUTO_BUTTON} onClick={goNext} disabled={signup.isPending}>
                {signup.isPending ? "Creating account…" : "Create my account"}
              </AuthButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
