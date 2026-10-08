"use client";

import { useState } from "react";
import AuthorAvatar from "@/app/components/reader/notes/AuthorAvatar";
import AuthorRow from "@/app/components/reader/notes/AuthorRow";
import BookPreview from "@/app/components/reader/notes/BookPreview";
import HighlightCard from "@/app/components/reader/notes/HighlightCard";
import NoteContent from "@/app/components/reader/notes/NoteContent";
import ReactionButton from "@/app/components/reader/notes/ReactionButton";
import ReplyButton from "@/app/components/reader/notes/ReplyButton";

const SAMPLE_BOOK = {
  title: "The Wretched of the Earth",
  label: "Conclusion",
};

const SAMPLE_QUOTE = "Each generation must, out of relative obscurity, discover its mission, fulfill it, or betray it.";

const SAMPLE_NOTE = "Fifty years on and this still reads like a call aimed straight at us. What's our generation's mission?";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/**
 * Live preview of how a chosen pseudonym shows up on a real community note
 * — reuses AuthorAvatar/AuthorRow/HighlightCard/NoteContent/ReactionButton/
 * ReplyButton as-is (the exact components NoteCard renders on the home
 * feed), rather than a rough approximation, so the reader sees exactly what
 * they're about to put their name on. The book header reuses BookPreview
 * (title+section, no cover — see that component's own doc comment) but
 * isn't wrapped in a real deep link — the sample book isn't in the library,
 * and there's nowhere to send a reader who hasn't signed up yet.
 */
export default function NotePreviewCard({ pseudonym }: { pseudonym: string }) {
  // AuthorRow itself now applies the "Comrade " prefix (comradeName) — pass
  // the bare pseudonym so this preview doesn't double it up.
  const name = pseudonym.trim() || "Kofi Writes";
  const [reacted, setReacted] = useState(false);
  const [savedAt] = useState(() => Date.now() - TWO_HOURS_MS);

  return (
    <div className="rounded-sm border border-[var(--reader-border)] bg-[var(--reader-surface)] p-5">
      <div className="mb-3 text-[11px] font-bold tracking-[0.08em] text-[var(--reader-text-muted)]">
        PREVIEW OF A NOTE
      </div>
      <div className="flex flex-col gap-3">
        <BookPreview title={SAMPLE_BOOK.title} section={SAMPLE_BOOK.label} />

        <HighlightCard text={SAMPLE_QUOTE} />

        <div className="flex flex-col gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <AuthorAvatar author={{ readerId: "", pseudonym: name, city: null, avatar: null }} />
            <div className="min-w-0 flex-1">
              <AuthorRow name={name} savedAt={savedAt} />
            </div>
          </div>
          {/* pl-[30px]: same avatar-width + gap indent as NoteThreadCard's
              own content column — see that component's doc comment. */}
          <div className="flex min-w-0 flex-col gap-2 pl-[30px]">
            <NoteContent content={{ kind: "text", text: SAMPLE_NOTE }} />
            <div className="flex items-center gap-3.5">
              <ReactionButton count={reacted ? 24 : 23} reacted={reacted} onToggle={() => setReacted((v) => !v)} />
              <ReplyButton count={4} expanded={false} onToggle={() => {}} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
