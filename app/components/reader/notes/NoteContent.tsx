"use client";

import { useState } from "react";
import type { NoteContent as NoteContentValue } from "@/lib/api/types";
import LinkPreviewCard from "@/app/components/shared/LinkPreviewCard";
import VoiceNoteView from "./VoiceNoteView";
import { truncateQuote } from "./HighlightCard";
import { LINK_URL_PATTERN, extractLinks, normalizeLinkUrl } from "@/lib/community/links";

// Same idea as HighlightCard's own preview budget — a note's own body is
// the reader's writing, not a passage from the book, so it gets a somewhat
// longer allowance before "See more" kicks in.
const NOTE_PREVIEW_CHARS = 1500;

// A raw URL reads as noise once it's long — Twitter/Bluesky's own
// convention is a short "hostname/truncated-path" label in place of the
// full string, with the untruncated URL still the actual href.
const INLINE_LINK_LABEL_MAX_CHARS = 42;

function truncatedLinkLabel(url: string): string {
  let label: string;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search + parsed.hash;
    label = parsed.hostname.replace(/^www\./, "") + (path === "/" ? "" : path);
  } catch {
    label = url;
  }
  return label.length <= INLINE_LINK_LABEL_MAX_CHARS ? label : `${label.slice(0, INLINE_LINK_LABEL_MAX_CHARS - 1)}…`;
}

function linkify(text: string): Array<string | { url: string; label: string }> {
  return text.split(LINK_URL_PATTERN).map((part) => {
    if (!LINK_URL_PATTERN.test(part)) return part;
    LINK_URL_PATTERN.lastIndex = 0; // .test() with a /g regex advances lastIndex — reset for the next part
    const url = normalizeLinkUrl(part);
    return { url, label: truncatedLinkLabel(url) };
  });
}

/** One note/reply's actual content — text or voice — with no author,
 * timestamp, or actions bundled in (see AuthorRow for those); split out so
 * the same rendering works at both the top-level-note and reply scale. */
export default function NoteContent({
  content,
}: {
  content: NoteContentValue;
}) {
  const [expanded, setExpanded] = useState(false);

  if (content.kind === "voice") {
    return <VoiceNoteView audioUrl={content.audioUrl} durationMs={content.durationMs} />;
  }
  const linkUrls = extractLinks(content.text);
  const { shown, isTruncated } = truncateQuote(content.text, NOTE_PREVIEW_CHARS);
  const displayedText = expanded ? content.text : shown;
  return (
    // gap-2 spaces the text from its own link previews, internal to this
    // block only. The block as a whole carries no bottom margin of its own
    // — NoteThreadCard's reaction row owns all spacing beneath whatever
    // renders here, text/link previews alike.
    <div className="flex min-w-0 flex-col gap-2">
      {/* "See more" sits right after the truncated run, inline in the same
          paragraph — see HighlightCard's identical treatment for why. It's
          one-way: clicking it reveals the rest and the trigger itself
          disappears (only renders while `!expanded`), no "See less" toggle
          back. */}
      {/* Attachment-only notes (a book/link dropped with no written body)
          carry an empty `content.text` — skipping the paragraph entirely
          here, rather than rendering it empty, avoids a blank line's worth
          of leading pushing the reaction row down further than a note that
          actually has visible content above it. */}
      {content.text.trim() !== "" && (
        <p className="m-0 min-w-0 whitespace-pre-wrap break-words font-serif type-4 text-[var(--reader-text)]">
          {linkify(displayedText).map((part, i) =>
            typeof part === "string" ? (
              <span key={i}>{part}</span>
            ) : (
              <a
                key={i}
                href={part.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                onClick={(e) => e.stopPropagation()}
                title={part.url}
                className="text-[var(--color-app-text-secondary)] underline decoration-1 underline-offset-2 decoration-[var(--color-app-border)] hover:text-[var(--reader-accent)]"
              >
                {part.label}
              </a>
            )
          )}
          {isTruncated && !expanded && (
            <>
              {" "}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(true);
                }}
                className="cursor-pointer border-none bg-transparent p-0 font-sans text-[12px] font-medium text-[var(--color-app-text-secondary)] hover:text-[var(--color-app-text)]"
              >
                See more
              </button>
            </>
          )}
        </p>
      )}
      {(!isTruncated || expanded) && linkUrls.length > 0 && (
        <div className="flex flex-col">
          {linkUrls.map((linkUrl) => (
            <LinkPreviewCard key={linkUrl} url={linkUrl} />
          ))}
        </div>
      )}
    </div>
  );
}
