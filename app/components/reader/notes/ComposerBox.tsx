"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode, Ref } from "react";
import { ArrowUp } from "lucide-react";
import LinkPreviewCard from "@/app/components/shared/LinkPreviewCard";
import { extractLinks } from "@/lib/community/links";

/** Below this, a tap on an `immersive` box opens it full screen. */
const MOBILE_MAX_PX = 639;

/** The one compose box every writing surface shares — Home (HomeComposer),
 * notes and replies (NoteComposer) and the room chat (RoomChatComposer).
 * A chat input: your face (hidden while you type), the field, then quiet
 * `tools` and a small send arrow on the same line; `children` (link previews, a shared passage)
 * sit above it, `footer` (errors) below. On a phone an `immersive` box
 * opens full screen on a tap: Cancel, `title` and Post along the top, your
 * face beside the writing, the tools along the bottom. */
export default function ComposerBox({
  avatar,
  value,
  onChange,
  placeholder,
  label,
  maxLength,
  autoFocus,
  submitOnEnter,
  inputRef,
  containerRef,
  tools,
  canPost,
  postLabel = "Post",
  onPost,
  onCancel,
  immersive = true,
  title = "New note",
  footer,
  children,
}: {
  avatar?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
  maxLength?: number;
  autoFocus?: boolean;
  /** Enter sends, Shift+Enter starts a new line (the chat). */
  submitOnEnter?: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
  containerRef?: Ref<HTMLDivElement>;
  tools?: ReactNode;
  canPost: boolean;
  postLabel?: string;
  onPost: () => void;
  /** Present when there's something to cancel: Escape does it. */
  onCancel?: () => void;
  /** Opens full screen on a phone. The chat, already full screen, opts out. */
  immersive?: boolean;
  /** The full-screen header. */
  title?: string;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const [isMobile, setIsMobile] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_PX}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [full, setFull] = useState(false);
  const isFull = full && isMobile && immersive;

  useEffect(() => {
    if (!isFull) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isFull]);

  const post = () => {
    if (!canPost) return;
    onPost();
    setFull(false);
  };

  const textarea = (fullScreen: boolean) => (
    <textarea
      ref={fullScreen === isFull ? inputRef : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => {
        if (!fullScreen && isMobile && immersive) {
          e.currentTarget.blur();
          setFull(true);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onCancel) {
          e.preventDefault();
          onCancel();
          return;
        }
        if (submitOnEnter && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          post();
        }
      }}
      rows={1}
      autoFocus={fullScreen || autoFocus}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={label ?? placeholder}
      className={`om-scroll field-sizing-content min-w-0 flex-1 resize-none border-none bg-transparent py-1.5 font-medium text-[var(--reader-text)] outline-none placeholder:text-[var(--reader-text-muted)] ${
        fullScreen ? "min-h-30 text-[14px] leading-relaxed" : "max-h-60 text-[14px] leading-[1.45]"
      }`}
    />
  );

  return (
    <>
      <div
        ref={isFull ? undefined : containerRef}
        className="group/box flex flex-col gap-2 rounded-sm border border-[var(--reader-border)] bg-[var(--reader-surface)] px-2.5 py-2 text-[var(--reader-text)] transition-colors focus-within:border-[color-mix(in_srgb,var(--reader-text)_24%,transparent)]"
      >
        {!isFull && children}
        <div className="flex items-end gap-1.5">
          {avatar && <span className="flex flex-none self-end pb-[3px] group-focus-within/box:hidden">{avatar}</span>}
          {textarea(false)}
          <div className="flex flex-none items-center gap-0.5 self-end pb-[3px] text-[var(--reader-text-muted)]">
            {tools}
            <button
              type="button"
              onClick={post}
              disabled={!canPost}
              aria-label={postLabel}
              title={postLabel}
              className={`${COMPOSER_TOOL} disabled:cursor-default disabled:opacity-40 ${
                canPost ? "!bg-[var(--reader-accent)] !text-[var(--reader-bg)]" : ""
              }`}
            >
              <ArrowUp size={16} strokeWidth={2.25} />
            </button>
          </div>
        </div>
        {!isFull && footer}
      </div>

      {isFull &&
        createPortal(
          <div
            ref={containerRef}
            data-full
            className="group/composer fixed inset-0 z-[100] flex flex-col bg-[var(--reader-surface)]"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="flex flex-none items-center justify-between gap-3 border-b border-[var(--reader-border)] px-4 py-2.5">
              <button
                type="button"
                onClick={() => setFull(false)}
                className="cursor-pointer border-none bg-transparent px-1 py-1.5 text-sm font-medium text-[var(--reader-text-muted)]"
              >
                Cancel
              </button>
              <span className="text-sm font-semibold">{title}</span>
              <button
                type="button"
                onClick={post}
                disabled={!canPost}
                className={`rounded-full border-none px-4 py-1.5 text-sm font-semibold transition-colors ${
                  canPost
                    ? "cursor-pointer bg-brand-500 text-white"
                    : "cursor-default bg-[var(--reader-surface-hover)] text-[var(--reader-text-muted)]"
                }`}
              >
                {postLabel}
              </button>
            </div>
            <div className="om-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              <div className="flex items-start gap-2.5">
                {avatar && <span className="flex flex-none pt-1">{avatar}</span>}
                {textarea(true)}
              </div>
              {children}
              {footer}
            </div>
            {tools && (
              <div
                className="flex flex-none items-center gap-1.5 border-t border-[var(--reader-border)] px-4 py-2 text-[var(--reader-text-muted)]"
                style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
              >
                {tools}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/** A quiet round icon button for the box's tools. A `<span>` inside
 * carrying COMPOSER_TOOL_LABEL shows only full screen, where there's room. */
export const COMPOSER_TOOL =
  "flex h-8 min-w-8 flex-none cursor-pointer items-center justify-center gap-1.5 rounded-full border-none bg-transparent px-2 text-[var(--reader-text-muted)] hover:bg-[var(--reader-surface-hover)] hover:text-[var(--reader-text)]";
export const COMPOSER_TOOL_LABEL = "hidden text-[13px] font-medium group-data-[full]/composer:inline";

/** A live preview per link in `text`, each dismissible for this draft —
 * the same links the posted note renders (NoteContent). */
export function ComposerLinks({ text }: { text: string }) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const links = useMemo(() => extractLinks(text).filter((url) => !dismissed.has(url)), [text, dismissed]);
  if (links.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {links.map((url) => (
        <LinkPreviewCard
          key={url}
          url={url}
          dismissible
          onDismiss={() => setDismissed((existing) => new Set(existing).add(url))}
        />
      ))}
    </div>
  );
}
