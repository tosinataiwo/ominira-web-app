"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Headphones, Moon, Search, SquareArrowOutUpRight, Sun, X } from "lucide-react";
import type { Section } from "@/lib/book/schema";
import { useReaderStore } from "@/stores/reader-store";
import Tooltip from "./Tooltip";
import ChapterPill from "./ChapterPill";

type Props = {
  visible?: boolean;
  topBarHeightPx: number;
  railInsetPx: number;
  /** Present only when the viewer is mounted inside the (.)read/[slug]
   * overlay (ReaderModal.tsx and its PDF/DOCX/webpage counterparts) —
   * swaps the leading control from a Link back to home into a plain close
   * button, since "back" would otherwise describe a page navigation that
   * isn't actually happening here. Absent on the standalone /read/[slug]
   * route, which uses browser history. Deliberately the *only* thing that
   * picks X vs. the back arrow — same on mobile and desktop, an overlay is
   * always X and a standalone page is always back, regardless of viewport. */
  onClose?: () => void;
  /** No listen button at all when there's nothing to narrate — not even a
   * disabled one. Every format narrates through the one NarrationEngine
   * (live AI narration); this is false only when there's no text to read. */
  canListen?: boolean;
  /** While true, the button below is hidden entirely rather than turned
   * into a play/pause toggle — the persistent player (NowPlayingBar) is
   * the only place play/pause lives once listening has started, so
   * there's exactly one control per action and no way for the two to
   * drift out of sync. This button's only job is *starting* listen mode;
   * closing the player (its own X) is what brings it back. */
  isListen?: boolean;
  onListen?: () => void;
  /** Omitted (not a disabled icon) when there's no search to run —
   * SearchModal operates over a BookDocument's section/passage tree, which
   * only EPUB has; PDF/DOCX/webpage get no search icon until they have
   * some real search behind it (an in-page find over the flat article
   * text, say) to wire up instead. */
  onToggleSearch?: () => void;
  /** Current chapter/section, rendered as a ChapterPill between the back
   * button and the icon cluster — see ChapterPill's own doc comment for
   * why the outline no longer has a dedicated icon. EPUB-only; PDF/DOCX/
   * webpage pass `title`/`author` instead (see below), since they have no
   * chapter structure to show a pill for. */
  activeSection?: Section;
  onToggleChapters?: () => void;
  /** The document's own title, shown in the same slot ChapterPill occupies
   * and styled identically to its label (single line, no subtitle) — the
   * two are mutually exclusive in practice (EPUB always has `activeSection`
   * once loaded and never passes this; PDF/DOCX/webpage always pass this
   * and never have a section to show instead), so whichever is present is
   * what renders. */
  title?: string;
  /** The original page a webpage material was extracted from — renders a
   * Brave-Speedreader-style "view original" link, since the extracted copy
   * is deliberately a stripped derivative, not a replacement for the
   * source (document-readers-spec.md § 3). Unset for every other format. */
  sourceUrl?: string;
  /** Format-specific controls (PDF's page prev/next, say), rendered left of
   * the theme toggle — the one extension point every document viewer needs
   * without each one growing its own header variant. */
  children?: React.ReactNode;
};

const iconButtonClass =
  "w-9 h-9 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center flex-none text-[var(--reader-text)] transition-colors hover:bg-[var(--reader-surface-hover)]";

/**
 * The one header every reader format mounts — EPUB (Reader.tsx), PDF, DOCX,
 * and web-article viewers all render this same component, not one each,
 * per document-readers-spec.md § 2's shell-extraction goal: the same
 * close/back-then-title-then-actions layout and styling everywhere, so the
 * reading UX feels identical regardless of format, and a future feature
 * (in-page search for the flat formats, say) is a prop this component
 * grows once, not a second header component to keep in sync. Back arrow
 * (or close X — see `onClose`), then either the current-chapter pill
 * (EPUB, via ChapterPill) or a plain title/author block (everything else,
 * which has no chapter structure), then (right) format-specific `children`,
 * a "view original" link (webpage only), listen, search, and a theme
 * switch — each of the last three appears only when its handler is
 * actually provided, so a format with nothing behind a given action simply
 * doesn't show it rather than rendering a dead button.
 *
 * The fuller type/layout config menu (font size, spacing, width, family)
 * that used to live behind a "Settings" popover here is shelved for now in
 * favor of this plain sun/moon toggle. Typography is set in
 * stores/reader-store.ts (DEFAULT_TYPOGRAPHY / setTypography), which every
 * format reads, so a future settings UI can drive it from here. Same show/hide-on-scroll/click lifecycle as EPUB always had
 * (`visible`, default true for formats with no such scroll-driven chrome
 * of their own yet).
 */
export default function ReaderHeader({
  visible = true,
  topBarHeightPx,
  railInsetPx,
  onClose,
  canListen = false,
  isListen = false,
  onListen,
  onToggleSearch,
  activeSection,
  onToggleChapters,
  title,
  sourceUrl,
  children,
}: Props) {
  const router = useRouter();
  const theme = useReaderStore((s) => s.theme);
  const setTheme = useReaderStore((s) => s.setTheme);

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  return (
    <div
      style={{ height: topBarHeightPx, paddingLeft: railInsetPx, paddingRight: railInsetPx }}
      // select-none/no-callout: this is all chrome, nothing here is meant
      // to be selectable text — same reasoning as the .no-callout comment
      // in globals.css (an explicit boundary, not an inherited guess, is
      // what keeps Safari's long-press selection from getting confused).
      className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-2 box-border border-b border-[var(--reader-border)] bg-[var(--reader-surface)] transition-[transform,opacity] duration-200 ease-out select-none no-callout ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
      }`}
    >
      {/* Back/close + the chapter pill are one group here (not two direct
          flex children of the justify-between row) so this still lays out
          correctly whether or not ChapterPill has anything to show (it
          renders null with no active section) — justify-between only ever
          sees this group and the icon cluster below, not a 2-vs-3-children
          reshuffle. */}
      <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
        {onClose ? (
          <Tooltip label="Close" side="bottom" align="start">
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-9 h-9 rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] flex items-center justify-center text-[var(--reader-text)] flex-none cursor-pointer"
            >
              <X size={18} />
            </button>
          </Tooltip>
        ) : (
          <Tooltip label="Back" side="bottom" align="start">
            <button
              onClick={handleBack}
              aria-label="Back"
              className="w-9 h-9 rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] flex items-center justify-center text-[var(--reader-text)] no-underline flex-none"
            >
              <ArrowLeft size={18} />
            </button>
          </Tooltip>
        )}

        {activeSection ? (
          <ChapterPill section={activeSection} onClick={onToggleChapters ?? (() => {})} />
        ) : (
          title && (
            // Same single-line treatment as ChapterPill's own label (no
            // author subtitle, no chevron since there's no chapters drawer
            // to open) — the two are meant to read as the same kind of
            // header element, just one is clickable and one isn't.
            <span className="min-w-0 sm:max-w-60 md:max-w-80 truncate px-2 py-1.5 -ml-1 text-[13px] font-semibold text-[var(--reader-text)]">
              {title}
            </span>
          )
        )}
      </div>

      <div className="flex items-center gap-1.5 md:gap-4 flex-none">
        {sourceUrl && (
          <Tooltip label="View original" side="bottom" align="end">
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="View original" className={iconButtonClass}>
              <SquareArrowOutUpRight size={16} />
            </a>
          </Tooltip>
        )}

        {children}

        {canListen && !isListen && onListen && (
          <Tooltip label="Listen to this book" side="bottom">
            <button onClick={onListen} aria-label="Listen to this book" className={iconButtonClass}>
              <Headphones size={16} />
            </button>
          </Tooltip>
        )}

        {onToggleSearch && (
          <Tooltip label="Search" side="bottom" align="end">
            <button onClick={onToggleSearch} aria-label="Search" className={iconButtonClass}>
              <Search size={16} />
            </button>
          </Tooltip>
        )}

        <Tooltip label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} side="bottom" align="end">
          <button
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            className={iconButtonClass}
          >
            {theme === "light" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
