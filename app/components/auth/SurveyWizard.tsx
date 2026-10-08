"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Wordmark from "./Wordmark";
import AuthButton from "./AuthButton";
import BackArrow from "./BackArrow";
import PillGroup from "@/app/components/PillGroup";
import TextField from "@/app/components/auth/TextField";
import type { MaterialSummary } from "@/lib/api/types";
import BookListRow from "@/app/components/shell/BookListRow";
import { useSurveySubmit } from "@/lib/auth/useSurveySubmit";
import { onboardingRoute } from "@/lib/auth/onboardingRoute";
import type { ReaderAgeRange } from "@/lib/api/types";

const TOTAL_STEPS = 3;
const GENDER_IDENTITY_MAX_LENGTH = 40;

const AGE_RANGE_OPTIONS: { value: ReaderAgeRange; label: string }[] = [
  { value: "13_17", label: "13–17" },
  { value: "18_24", label: "18–24" },
  { value: "25_34", label: "25–34" },
  { value: "35_44", label: "35–44" },
  { value: "45_54", label: "45–54" },
  { value: "55_64", label: "55–64" },
  { value: "65_plus", label: "65+" },
];

type Props = {
  materials: MaterialSummary[];
  categories: string[];
};

export default function SurveyWizard({ materials, categories }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [readMaterialIds, setReadMaterialIds] = useState<Set<string>>(new Set());
  const [interests, setInterests] = useState<Set<string>>(new Set());
  const [ageRange, setAgeRange] = useState<ReaderAgeRange | null>(null);
  const [genderIdentity, setGenderIdentity] = useState("");
  const survey = useSurveySubmit();

  const toggleRead = (materialId: string) =>
    setReadMaterialIds((prev) => {
      const next = new Set(prev);
      if (next.has(materialId)) next.delete(materialId);
      else next.add(materialId);
      return next;
    });
  const toggleInterest = (value: string) =>
    setInterests((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  const goNext = () => {
    if (step === 2) {
      survey.mutate(
        {
          interests: Array.from(interests),
          readMaterialIds: Array.from(readMaterialIds),
          ageRange,
          genderIdentity: genderIdentity.trim() || null,
        },
        { onSuccess: ({ reader }) => router.push(onboardingRoute(reader)) }
      );
    } else {
      setStep((s) => s + 1);
    }
  };
  const goBack = () => {
    if (step === 0) {
      if (typeof window !== "undefined" && window.history.length > 1) {
        router.back();
      } else {
        router.push("/");
      }
    } else {
      setStep((s) => s - 1);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--reader-bg)] px-6 py-8 shell:px-16 shell:py-16 xl:px-24">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <BackArrow onClick={goBack} className="-ml-2" />
          <div className="hidden shell:block">
            <Wordmark />
          </div>
        </div>
        <div className="mt-6 text-xs font-bold tracking-[0.1em] text-brand-500">
          STEP {step + 1} OF {TOTAL_STEPS}
        </div>
      </div>

      <div className="mx-auto w-full max-w-sm shell:max-w-2xl">
        {step === 0 ? (
          <div>
            <h1 className="font-serif type-1 text-balance text-[var(--reader-text)]">
              Have you read any of these books?
            </h1>
            <p className="mt-3 font-serif text-[14px] text-[var(--reader-text-muted)]">
              You can choose as many as you&rsquo;ve read or none if you haven&rsquo;t read any.
            </p>

            <div className="om-scroll mt-6 max-h-[60vh] overflow-y-auto pr-1">
              {/* Same 2-column grid as LibraryView's own catalogue listing —
                  this is deliberately the library's own book row, made
                  selectable, not a bespoke checklist look. */}
              <div className="grid grid-cols-1 gap-x-6 shell:grid-cols-2">
                {materials.map((material) => (
                  <BookListRow
                    key={material.id}
                    material={material}
                    selection={{
                      selected: readMaterialIds.has(material.id),
                      onToggle: () => toggleRead(material.id),
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="mt-8 flex justify-center">
              <AuthButton className="shell:w-60 shell:px-10" onClick={goNext}>
                Continue
              </AuthButton>
            </div>
          </div>
        ) : step === 1 ? (
          <div>
            <h1 className="font-serif type-1 text-balance text-[var(--reader-text)]">
              What are you interested in?
            </h1>
            <p className="mt-3 font-serif text-[14px] text-[var(--reader-text-muted)]">
              Select the categories you&rsquo;re most interested in.
            </p>

            <div className="mt-6">
              <PillGroup
                options={categories.map((category) => ({ value: category, label: category }))}
                selected={Array.from(interests)}
                onSelect={toggleInterest}
                size="lg"
              />
            </div>

            <div className="mt-8 flex justify-center">
              <AuthButton className="shell:w-60 shell:px-10" onClick={goNext}>
                Continue
              </AuthButton>
            </div>
          </div>
        ) : (
          <div>
            <h1 className="font-serif type-1 text-balance text-[var(--reader-text)]">
              Tell us your age and gender?
            </h1>
            <p className="mt-3 font-serif text-[14px] text-[var(--reader-text-muted)]">
              Optional and anonymous. Skip anything you&rsquo;d rather not say.
            </p>

            <div className="mt-6">
              <div className="text-xs font-semibold tracking-[0.05em] text-[var(--reader-text-muted)] uppercase">
                Age range <span className="font-normal normal-case text-[var(--reader-text-subtle)]">(optional)</span>
              </div>
              <div className="mt-2">
                <PillGroup
                  options={AGE_RANGE_OPTIONS}
                  selected={ageRange ?? ""}
                  onSelect={(value) => setAgeRange((prev) => (prev === value ? null : (value as ReaderAgeRange)))}
                  size="lg"
                />
              </div>
            </div>

            <div className="mt-6">
              <TextField
                label="What do you identify as? (optional)"
                placeholder="In your own words, or leave blank"
                value={genderIdentity}
                onChange={(e) => setGenderIdentity(e.target.value)}
                maxLength={GENDER_IDENTITY_MAX_LENGTH}
                hint={`${genderIdentity.length}/${GENDER_IDENTITY_MAX_LENGTH}`}
              />
            </div>

            {survey.error && (
              <p className="mt-4 text-center text-[13px] font-medium text-red-500">{survey.error.message}</p>
            )}

            <div className="mt-8 flex flex-col items-center gap-3">
              <AuthButton className="shell:w-60 shell:px-10" onClick={goNext} disabled={survey.isPending}>
                {survey.isPending ? "Saving…" : "Continue"}
              </AuthButton>
              {(ageRange || genderIdentity) && (
                <button
                  type="button"
                  onClick={() => {
                    setAgeRange(null);
                    setGenderIdentity("");
                  }}
                  disabled={survey.isPending}
                  className="cursor-pointer border-none bg-transparent p-0 text-[13px] font-medium text-[var(--reader-text-muted)] underline decoration-dotted underline-offset-4 hover:text-[var(--reader-text)]"
                >
                  Clear and skip this
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
