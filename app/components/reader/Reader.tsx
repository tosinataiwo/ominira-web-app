"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NotesSidebar from "./NotesSidebar";
import FeedPanel from "./notes/FeedPanel";
import { epubFeedLocator, type FeedEntry } from "@/lib/reader/annotationFeed";
import SearchModal from "../SearchModal";
import FootnotePopover from "./FootnotePopover";
import type { NoteLookup } from "./PassageContent";
import BookContent from "./BookContent";
import DocumentEndPanel from "./DocumentEndPanel";
import ReaderHeader from "./ReaderHeader";
import NotesFeedFab from "./NotesFeedFab";
import ChaptersDrawer from "./ChaptersDrawer";
import ChapterNavFooter from "./ChapterNavFooter";
import SelectionActions, { useShareQuote } from "./SelectionActions";
import BackToCurrentButton from "./BackToCurrentButton";
import Loader from "../Loader";
import type { BookDocument, Passage, Section } from "@/lib/book/schema";
import { useReaderStore, useTypographyStyle } from "@/stores/reader-store";
import { useReadingPositionStore } from "@/stores/reading-position-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useAudioStore } from "@/stores/audio-store";
import { activeRoom, useRoomStore } from "@/stores/room-store";
import { useDockedHeight, useNarrationBarHeight } from "@/app/components/useBottomDock";
import { useNarrationStore } from "@/stores/narration-store";
import { useNarratedWord } from "./useNarratedWord";
import { spokenPassageText, wordIndexAt } from "@/lib/audio/narrationText";
import { buildSectionsById, resolveSpineTarget } from "@/lib/reader/sections";
import { useSectionCarousel } from "@/lib/reader/useSectionCarousel";
import { useResumeScroll } from "@/lib/reader/useResumeScroll";
import { useProgressiveText } from "@/lib/reader/useProgressiveText";
import { useReadingProgress } from "@/lib/reader/useReadingProgress";
import { useTextAnnotations } from "@/lib/reader/useTextAnnotations";
import { createDomSurface } from "@/lib/annotations/surface";
import { useTextSelection } from "@/lib/annotations/useTextSelection";
import { useFeed } from "@/lib/reader/useFeed";
import { useServerPositionReady } from "@/lib/reader/useServerPositionReady";
import { sectionLabel } from "@/lib/reader/sectionHeading";
import { buildEpubScale } from "@/lib/reader/locator";
import { epubView } from "@/lib/room/view";
import { useRoomView } from "@/lib/room/useRoomView";

export default function Reader({
  book,
  materialId,
  eagerSectionIds,
  targetSectionId,
  targetPassageId,
  targetPassageIndex,
  targetNoteId,
  targetGeneralNoteId,
  targetThreadId,
  autoListen,
  onClose,
}: {
  book: BookDocument;
  /** The book's real `materials.id` (UUID) — distinct from `book.id`
   * (ingestion's own slug-like internal id, api-spec.md). Everything that
   * reads/writes reading position (reading-position-store, audio-store's
   * "now playing" slot) keys off this, never `book.id`. */
  materialId: string;
  /** Which section(s) of `book.sections` already carry real prose —
   * everything else starts with blanked-out passage text (see
   * toBookDocument.ts), backfilled by useProgressiveText below. */
  eagerSectionIds: string[];
  /** ?section=<id> — either a chapter link (ToC/search, first-passage
   * default) or, paired with targetPassageIndex, the book-detail page's own
   * "Resume reading" button. See useResumeScroll's own doc comment. */
  targetSectionId?: string;
  /** ?passage=<id> — the home community feed's deep links, narrowing
   * targetSectionId down to one specific passage instead of that
   * section's first one. */
  targetPassageId?: string;
  /** ?passageIndex=<n> — BookDetailView's "Resume reading" button, paired
   * with targetSectionId. Sourced straight from this reader's own
   * `reader_activities` row (via useContinueReading, already in hand by the
   * time that button renders) rather than asking this device's local mirror
   * to reconstruct the same thing — see useResumeScroll's own doc comment
   * for why that reconstruction is what used to go wrong. */
  targetPassageIndex?: number;
  /** ?note=<annotationId> — paired with targetPassageId, opens that
   * specific annotation's thread once the reader has landed, the same as
   * clicking its inline marker would (see the deep-link effect below). */
  targetNoteId?: string;
  /** ?noteId=<uuid> — push notification deep link for general (unanchored)
   * notes that have no passage to scroll to. Opens the book-wide feed panel
   * and scrolls to that general note, mirroring how anchored notes open the
   * per-passage thread and flash the highlight. */
  targetGeneralNoteId?: string;
  /** ?thread=<uuid> — notification deep link for the specific thread (root
   * note) whose replies should be auto-expanded and fully shown. For anchored
   * notes this is separate from targetNoteId (which is the annotation id);
   * for general notes it duplicates targetGeneralNoteId. */
  targetThreadId?: string;
  /** ?listen=1 — the book-detail page's own Listen button hands this
   * intent off through the URL rather than calling openBook itself,
   * because getting here now means a real navigation (see its own
   * hardNavigate comment), and audio-store's `book` field isn't persisted
   * across one (only `speed` is). Acted on once, below, the same as
   * ReaderHeader's own onListen={() => openBook(book)}. */
  autoListen?: boolean;
  /** Present only when Reader is mounted inside the (.)read/[slug] modal
   * (ReaderModal.tsx) rather than as the standalone /read/[slug] page —
   * swaps the header's "back to home" link for a plain close button, so
   * closing an overlay never masquerades as a real page navigation. Absent
   * on the standalone route, where the existing Link-to-home is still
   * correct (there's no overlay to close, just a page to leave). */
  onClose?: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  // Set from either the fresh-selection pill's Share action or NotesSidebar's
  // "Share passage" menu item — both just need the quote text; author/book
  // title/cover come straight from `book` below, the same for either entry
  // point.
  const [noteOpen, setNoteOpen] = useState<{ note: NoteLookup; top: number; left: number } | null>(
    null
  );
  // See openNoteMarker's own comment below — whether the currently-open
  // notesPanel should be exempted from the usual "notes panel open ⇒ hide
  // header" rule (chromeVisible, further down).
  const [notesPanelKeepsHeader, setNotesPanelKeepsHeader] = useState(false);

  const {
    getForPassage: getAnnotations,
    selection,
    notesPanel,
    overlay,
    dismissOverlay,
    onTextSelect,
    dismissSelection,
    highlightSelection,
    noteFromSelection,
    hasExistingAnnotation,
    deleteSelection,
    onNoteMarkerClick,
    closeNotesPanel,
  } = useTextAnnotations(materialId);

  const theme = useReaderStore((s) => s.theme);
  const typographyStyle = useTypographyStyle();

  // "Now playing" is a single global slot (audio-store), not a per-book
  // flag — this book is in listen mode exactly when it's the one loaded
  // there. That's what makes the player survive navigation to another
  // page (reader-issues: permanence): closing it is the only thing that
  // clears the slot, never just navigating away from this book's page.
  const audioStoreBook = useAudioStore((s) => s.book);
  const openBook = useAudioStore((s) => s.openBook);
  const openBookAtPassage = useAudioStore((s) => s.openBookAtPassage);
  const playAudio = useAudioStore((s) => s.play);
  const pauseAudio = useAudioStore((s) => s.pause);
  const updateBookContent = useAudioStore((s) => s.updateBookContent);
  const dockedHeight = useDockedHeight();
  const narrationBarHeight = useNarrationBarHeight();
  const anyPlayerActive = audioStoreBook !== null;
  // Listening no longer requires a prerecorded narratorTrack — NarrationEngine
  // falls back to live, on-demand AI narration for any section without one —
  // so this only guards against a genuinely empty book.
  const canListen = book.spine.length > 0;
  const isListen = audioStoreBook?.id === book.id;

  // Every section's structure (spine order, ids, audio, passage counts/
  // types) is real from the very first render — only the actual prose
  // fills in progressively, section by section, starting from whichever
  // one(s) `eagerSectionIds` names (see toBookDocument.ts). `sections`
  // below is what every downstream consumer (orderedSections,
  // passageLookup, search, the book-wide notes feed, BookContent itself,
  // and — critically — audio-store's `book` once listen mode opens) reads
  // instead of the static `book.sections` prop, so all of them improve
  // automatically as more of the book arrives, with no separate "is this
  // stale" bookkeeping needed anywhere else in this file.
  const { sections, ensureTextLoaded, loadAllTextInBackground } = useProgressiveText({
    materialId,
    initialSections: book.sections,
    eagerSectionIds,
  });
  // The same BookDocument shape every child already expects, just with the
  // live (progressively-filling) sections tree swapped in for the static
  // one the server sent — so BookContent/ChaptersDrawer/NarrationEngine
  // need no prop-shape changes at all, only this one substitution at each
  // call site.
  const liveBook = useMemo<BookDocument>(() => ({ ...book, sections }), [book, sections]);

  // See autoListen's own doc comment above — a one-time echo of what
  // ReaderHeader's onListen does on click, fired instead on mount when the
  // book-detail page's Listen button is why we're here. Opens with
  // liveBook, not the static `book` prop — passing the static prop here
  // used to mean any non-eager section (most of the book, on first open)
  // permanently had blank passage.text as far as NarrationEngine's
  // narrationIndex was concerned, even once the reader itself had the real
  // prose in hand — a section like this wouldn't just be missing from the
  // narration queue, it would never make a single narration request at
  // all, silently.
  useEffect(() => {
    if (autoListen && !isListen) openBook(liveBook, materialId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately fires once on mount only; autoListen/liveBook/materialId are fixed at mount for this purpose, and isListen is read once as a mount-time guard, not tracked afterward.
  }, []);

  // Keeps audio-store's own book copy current as more prose arrives —
  // openBook above (or ReaderHeader's onListen) only ever runs once, at
  // whatever moment listen mode starts, and progressive loading keeps
  // running in the background well past that moment for any book longer
  // than its eager section(s). Guarded to this book only (updateBookContent
  // itself also checks id, but isListen is the cheaper/earlier check) — a
  // reader who has navigated to a different book, or closed listen mode
  // for this one, shouldn't push stale content into whatever's playing now.
  useEffect(() => {
    if (isListen) updateBookContent(liveBook);
  }, [isListen, liveBook, updateBookContent]);

  const narrationAudioIndex = useNarrationStore((s) => s.audioIndex);
  const narrationAudioSection = useNarrationStore((s) => s.audioSection);
  const currentPlayingPassageId = useNarrationStore((s) => s.currentPlayingPassageId);
  const seekToPassageForListening = useNarrationStore((s) => s.seekToPassageForListening);
  const narrationExplicitJumpSeq = useNarrationStore((s) => s.explicitJumpSeq);
  const jumpNarrationToSection = useNarrationStore((s) => s.jumpToSection);
  // Drives om-listen-active (globals.css) — the cursor/hover affordance on
  // every word, not the active-word mark itself (that's the imperative
  // effect below, keyed on currentTimeMs, which changes far too often to
  // also drive a BookContent prop without defeating its memo()).
  const audioIsPlaying = useAudioStore((s) => s.isPlaying);
  // The word read aloud now — yours, or a room speaker's (useNarratedWord).
  const narratedWord = useNarratedWord(materialId);
  // Word spans are rendered while a speaker could read aloud to you, not only
  // while you listen, so a room's highlight has something to land on.
  const roomOnThisBook = useRoomStore((s) => activeRoom(s)?.room.materialId === materialId);

  // Paragraph controls deliberately own narration seeking. Word spans remain
  // present only for karaoke timing, never as click targets.
  const handlePassagePlayback = useCallback(
    (sectionId: string, passageId: string) => {
      if (isListen && currentPlayingPassageId === passageId) {
        if (audioIsPlaying) pauseAudio();
        else playAudio();
        return;
      }
      if (isListen) {
        seekToPassageForListening(sectionId, passageId);
        return;
      }
      openBookAtPassage(liveBook, materialId, sectionId, passageId);
    },
    [
      audioIsPlaying,
      currentPlayingPassageId,
      isListen,
      liveBook,
      materialId,
      openBookAtPassage,
      pauseAudio,
      playAudio,
      seekToPassageForListening,
    ]
  );

  // These stores skip automatic persist hydration (see their own comments)
  // specifically so the server and the client's first paint render
  // identical output — pulling in the real localStorage values here, once,
  // right after mount, is what actually restores them. `hydrated` gates the
  // loading overlay below — without it, the reader would paint once with
  // default theme/position and then visibly snap to the real
  // persisted values a moment later.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    Promise.all([useReaderStore.persist.rehydrate(), useReadingPositionStore.persist.rehydrate()])
      .catch(() => {}) // a storage read failure shouldn't hang the reader
      .then(() => setHydrated(true));
  }, []);

  // Seeds reading-position-store's local mirror from the server and reports
  // when that has actually had its chance to land — what useResumeScroll
  // waits on, and shared with every other surface that resumes (see the
  // hook's own doc comment). A device with no local write of its own for this
  // book yet (a second device, a fresh profile, cleared site data) would
  // otherwise commit to "nothing to resume" before the request ever arrived.
  const serverPositionReady = useServerPositionReady();

  const sectionsById = useMemo(() => buildSectionsById(sections), [sections]);

  // book.spine is already the whole book's reading order (front matter,
  // part dividers, and chapters alike) — the same order the sidebar and
  // audio auto-advance walk. Each spine entry is now one carousel "slide"
  // (reader-issues #2: section-per-page, not one continuous document).
  const orderedSections = useMemo(
    () => book.spine.map((id) => sectionsById.get(id)).filter((s): s is Section => Boolean(s)),
    [book.spine, sectionsById]
  );
  const sectionIds = useMemo(() => orderedSections.map((s) => s.id), [orderedSections]);

  const passageLookup = useMemo(() => {
    const byId = new Map<string, Passage>();
    const sectionOf = new Map<string, string>();
    for (const section of orderedSections) {
      for (const p of section.passages) {
        byId.set(p.id, p);
        sectionOf.set(p.id, section.id);
      }
    }
    return { byId, sectionOf };
  }, [orderedSections]);

  const locateFeedEntry = useMemo(() => epubFeedLocator(orderedSections), [orderedSections]);
  const noteFeed = useFeed({ materialId, locate: locateFeedEntry });
  const shareQuote = useShareQuote(book.metadata.title, book.metadata.author);

  // Published so NowPlayingBar (rendered in the root layout, well outside
  // this tree) can pull its own right edge in on desktop — see
  // layout-store's own doc comment on readerPanelOpen. Same condition that
  // drives the notes-panel wrapper's shell:w-95/shell:w-0 toggle below, so
  // the two can't drift out of sync with each other.
  // The feed and a thread's notes panel share one slot, and the room's
  // mini-player can open the feed from outside, so the feed opening closes
  // the thread.
  useEffect(() => {
    if (noteFeed.open) closeNotesPanel();
  }, [noteFeed.open, closeNotesPanel]);

  const setReaderPanelOpen = useLayoutStore((s) => s.setReaderPanelOpen);
  useEffect(() => {
    setReaderPanelOpen(!!notesPanel || noteFeed.open);
    return () => setReaderPanelOpen(false);
  }, [notesPanel, noteFeed.open, setReaderPanelOpen]);

  // Endnote/bibliography sections (e.g. "Notes") ingest one of two shapes —
  // bare chapter-divider headings (one per citing chapter, note bodies
  // diverted under each into book.notes) or entirely empty (the whole file
  // was note-body markup with no interstitial headers at all; ingestion
  // still gives it a spine slot since it's a titled, TOC-listed chapter —
  // see pipeline.py's all_leaves comment) — but either way the section's
  // *own* passages are never a reliable index into book.notes: a chapter-
  // divider list often opens with a page-title heading ("Notes") that isn't
  // itself a chapter, which shifts a positional pairing against book.notes
  // out of alignment for every entry after it. Group by each note's own
  // sectionId instead (always correct) and label groups from the *citing*
  // chapter's own title/heading — never from text found inside the notes
  // section itself.
  //
  // Candidate detection also has to reject a false-positive shape: a plain
  // two-line Part-divider page ("PART ONE" / "The Bolshevik") satisfies the
  // same "every passage is a heading" test as a real endnotes chapter. Where
  // one exists, prefer a candidate whose own title says "notes" before
  // falling back to the bare structural match.
  const notesIndexSectionId = useMemo(() => {
    if (!book.notes.length) return null;
    const isNotesShaped = (s: Section) =>
      s.passages.length === 0 ||
      (s.passages.length > 1 && s.passages.every((p: Passage) => p.type === "heading"));
    const titled = orderedSections.find((s) => isNotesShaped(s) && /note/i.test(s.title ?? ""));
    return titled?.id ?? orderedSections.find(isNotesShaped)?.id ?? null;
  }, [orderedSections, book.notes.length]);

  const notesIndexGroups = useMemo(() => {
    if (!notesIndexSectionId) return null;
    const orderedNoteSectionIds = Array.from(new Set(book.notes.map((n) => n.sectionId))).sort(
      (a, b) => book.spine.indexOf(a) - book.spine.indexOf(b)
    );
    return orderedNoteSectionIds.map((sectionId, i) => {
      const citingSection = sectionsById.get(sectionId);
      const label = (citingSection && sectionLabel(citingSection)) || "Notes";
      return {
        heading: { id: `${notesIndexSectionId}-h${i}`, index: i, type: "heading" as const, text: label },
        notes: book.notes.filter((n) => n.sectionId === sectionId),
      };
    });
  }, [notesIndexSectionId, sectionsById, book.notes, book.spine]);

  const notesById = useMemo(() => new Map(book.notes.map((n) => [n.id, n])), [book.notes]);

  // Any open modal/panel (or an active selection menu) suspends the
  // carousel's own keyboard/swipe handling, so typing in search or
  // arrow-keying through a picker never turns the page underneath. The
  // chapters drawer and the notes panel are both deliberately excluded —
  // neither is a blocking overlay (no scrim, see the notes-panel render
  // below), so the reader stays fully navigable (scroll/swipe/keyboard)
  // with either left open, same as the chapters drawer already was.
  const navDisabled = searchOpen || Boolean(noteOpen) || Boolean(selection);

  const {
    activeIndex,
    activeSectionId,
    goTo,
    goToSection,
    next,
    prev,
    registerSlide,
    getSlideEl,
    isMobile,
    chromeHidden,
    setChromeHidden,
    scrollPct,
    atBottom,
    onPointerDown,
    onPointerUp,
  } = useSectionCarousel({
    sectionIds,
    // The selection menu floats at a fixed viewport position tied to a text
    // range at the moment it opened — once the page scrolls, that position
    // no longer points at the selection, so treat any scroll as a dismissal
    // rather than leaving a stale menu floating in place. A page turn can
    // move the reader to a new slide with zero scroll events, so it gets
    // its own dismissal trigger (onNavigate) rather than relying on scroll.
    onNavigate: dismissSelection,
    disabled: navDisabled,
  });

  // The shared selection engine, bound to whichever section slide is active.
  const [slideEl, setSlideEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // After the carousel has committed the slide.
    const frame = requestAnimationFrame(() => setSlideEl(getSlideEl(activeSectionId) ?? null));
    return () => cancelAnimationFrame(frame);
  }, [getSlideEl, activeSectionId]);
  const selectionSurface = useMemo(
    () =>
      slideEl
        ? createDomSurface(slideEl, {
            blockAttribute: "data-passage-id",
            isTextBlock: (el) => el.dataset.passageType !== "image" && el.dataset.passageType !== "horizontalRule",
          })
        : null,
    [slideEl]
  );
  const selectionOverlay = useTextSelection({
    root: slideEl,
    scrollEl: slideEl,
    surface: selectionSurface,
    active: Boolean(selection),
    onSelect: onTextSelect,
    beneath: true,
  });

  // Every "jump to this section id" caller (chapters drawer, in-book link
  // marks) goes through this rather than calling goToSection directly — a
  // target id can name a navigation label (a Part grouping, or a v4
  // duplicate-TOC leaf with an empty passages array) that was never in
  // `spine` to begin with, and goToSection's plain sectionIds.indexOf would
  // just silently no-op on those. resolveSpineTarget walks forward to the
  // nearest real reading section instead.
  const navigateToSection = useCallback(
    (id: string, opts?: { animate?: boolean }) => {
      const target = resolveSpineTarget(id, sections, book.spine);
      if (target) goToSection(target, opts);
    },
    [sections, book.spine, goToSection]
  );

  const resumeReady = useResumeScroll({
    book,
    materialId,
    sectionsById,
    orderedSections,
    activeSectionId,
    goTo,
    getSlideEl,
    targetSectionId,
    targetPassageId,
    targetPassageIndex,
    serverPositionReady,
  });

  // Whichever section the reader actually lands on (server's own eager
  // guess, or — the common "just continue reading" case — wherever
  // useResumeScroll's client-only saved position actually points, which the
  // server has no way to have known) needs its real prose in hand before
  // the loader lifts — same gate as hydrated/resumeReady below, just for
  // text instead of theme/scroll-position. Everywhere else in the book
  // keeps filling in via loadAllTextInBackground below regardless.
  const [textReady, setTextReady] = useState(false);
  useEffect(() => {
    if (!resumeReady) return;
    let cancelled = false;
    ensureTextLoaded(activeSectionId).then(() => {
      if (!cancelled) setTextReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [resumeReady, activeSectionId, ensureTextLoaded]);

  // The "rest of the book, at once" wave — fired exactly once, right after
  // the reader's own starting section is settled, not paced by scroll or
  // navigation at all (see useProgressiveText's own doc comment).
  const backgroundLoadStartedRef = useRef(false);
  useEffect(() => {
    if (!resumeReady || backgroundLoadStartedRef.current) return;
    backgroundLoadStartedRef.current = true;
    loadAllTextInBackground();
  }, [resumeReady, loadAllTextInBackground]);

  // Defensive: a reader can navigate (chapters drawer, search result,
  // chapter-nav footer) to a section the background wave above hasn't
  // reached yet — this fetches that one specific section immediately
  // rather than leaving it blank until the whole-book wave gets there on
  // its own. A no-op whenever the target's already loaded or already in
  // flight (see ensureTextLoaded).
  useEffect(() => {
    if (!activeSectionId) return;
    ensureTextLoaded(activeSectionId);
  }, [activeSectionId, ensureTextLoaded]);

  // Gates the full-screen loader below — the reader isn't considered ready
  // until every piece of state it renders from (theme/font/position, via
  // `hydrated`; scroll position, via `resumeReady`; the starting section's
  // actual prose, via `textReady`) reflects the reader's actual saved data
  // rather than a first-paint default.
  const isReady = hydrated && resumeReady && textReady;

  // Plain reading (no audio) had no position-save path at all — only
  // listen-mode's own effects (now in NarrationEngine) ever called
  // setPosition, so leaving a book mid-chapter while just reading never
  // persisted anything finer than "which section," and resuming always
  // dropped the reader back at the chapter's first passage. This tracks
  // scroll position within the active section instead (skipping entirely
  // while isListen, which keeps owning its own audio-offset-aware writes).
  const { getPositionNow } = useReadingProgress({
    book,
    materialId,
    mode: isListen ? "listen" : "read",
    activeSectionId,
    activeSection: sectionsById.get(activeSectionId),
    getSlideEl,
    resumeReady,
  });

  // The end of the book, rendered at the bottom of the last spine section's
  // content by BookContent. Memoized because BookContent is `memo()`d — a
  // fresh element identity on every render of this (very busy) component
  // would defeat that memoization for the whole content tree.
  const endSlot = useMemo(
    () => <DocumentEndPanel materialId={materialId} title={book.metadata.title} getCurrentPosition={getPositionNow} />,
    [materialId, book.metadata.title, getPositionNow]
  );

  // Podcast-style auto-advance (spec.md): the narration engine (global,
  // book-agnostic) owns the actual position/audio-clock advance — this
  // only decides whether *this page's* carousel should also turn, which is
  // a page-local concern the engine can't know about. Comparing against
  // the *previous* audioIndex (not the current one) is what distinguishes
  // "the reader was following along when it advanced" from "the reader had
  // already turned away" — isFollowingNarration below is a plain snapshot
  // of the current relationship, but by the time audioIndex has already
  // moved, comparing against it directly would always read "away".
  //
  // This is the ONE place the carousel ever moves in response to
  // narration — every "jump narration somewhere" entry point (chapter-skip
  // buttons, the chapters drawer, clicking a paragraph, all the way
  // down in NarrationEngine) only ever changes narration-store's own
  // audioIndex/explicitJumpSeq; none of them touch the carousel directly
  // any more. The drawer used to also call navigateToSection itself,
  // alongside jumpNarrationToSection, on the theory that this effect's
  // "only follow if already following" rule would otherwise leave an
  // explicit jump not visually followed — two independent places each
  // deciding "what section is the reader looking at" for the same click,
  // racing each other, which is exactly the kind of multi-site state churn
  // that produced real "page unresponsive" hangs. explicitJumpSeq is what
  // let that second call site go away for good: an explicit jump (the seq
  // bumping) always forces the carousel to follow below, regardless of
  // `activeIndex`, while a quiet 'ended' auto-advance (the seq NOT
  // bumping) keeps the original "only if you were already watching along"
  // behavior. One producer of "narration moved" (NarrationEngine), one
  // consumer that decides what the carousel does about it (here).
  const prevAudioIndexRef = useRef(narrationAudioIndex);
  const seenExplicitJumpSeqRef = useRef(narrationExplicitJumpSeq);
  useEffect(() => {
    const isExplicitJump = narrationExplicitJumpSeq !== seenExplicitJumpSeqRef.current;
    seenExplicitJumpSeqRef.current = narrationExplicitJumpSeq;
    if (
      isListen &&
      narrationAudioIndex !== prevAudioIndexRef.current &&
      (isExplicitJump || activeIndex === prevAudioIndexRef.current)
    ) {
      goTo(narrationAudioIndex, { animate: true });
    }
    prevAudioIndexRef.current = narrationAudioIndex;
  }, [narrationAudioIndex, narrationExplicitJumpSeq, isListen, activeIndex, goTo]);

  // Which spine position audio is on, vs which slide the reader is
  // actually looking at (activeIndex, from the carousel) — deliberately
  // independent (manual navigation never forces one to match the other),
  // but when they DO match, that's "the reader is following narration".
  const isFollowingNarration = isListen && activeIndex === narrationAudioIndex;

  // Keeps the currently-narrated passage in view as playback advances —
  // only while the reader is actually following along. If they've
  // manually turned elsewhere, narration must never reach into an
  // off-screen slide and change its scroll position out from under them.
  useEffect(() => {
    if (!isFollowingNarration || !currentPlayingPassageId || !narrationAudioSection) return;
    const el = getSlideEl(narrationAudioSection.id)?.querySelector(
      `[data-passage-id="${currentPlayingPassageId}"]`
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentPlayingPassageId, isFollowingNarration, narrationAudioSection, getSlideEl]);

  // "Now narrating" word marker — plain classList toggling on whichever
  // [data-word-index] span is currently playing (om-narrating-word,
  // globals.css), concept 1b's "Highlighter Wash": exactly one word lit at
  // a time, nothing else in the sentence touched. Imperative DOM, not a
  // React prop threaded through BookContent: that tree is memoized
  // precisely so most of a long book never re-renders, and this changes far
  // too often (several times a second, every tick of playback) to route
  // through props without defeating that — the same reasoning the old
  // passage-level marker this replaced already used, just at a frequency
  // that makes it even more necessary here. Independent of
  // isFollowingNarration — the marker reflects what's actually playing
  // regardless of where the reader has scrolled to, same as any podcast app
  // still knows what's playing while you browse its list.
  //
  // Keyed off (passageId, word index) found, not off audioCurrentTimeMs
  // directly, so a tick that lands on the same word as before (most of
  // them — words last longer than one timeupdate interval) touches the DOM
  // not at all. Passage id is part of the key, not just the numeric index,
  // because the index alone can coincidentally repeat across a passage
  // switch (a new passage nearly always starts at word 0, which is exactly
  // the index a short previous passage was often already sitting on) — an
  // idx-only key would then treat "moved to a new passage's word 0" as "no
  // change" and leave the *old* passage's word 0 marked, which read as the
  // highlight reverting to the previous paragraph for a moment.
  //
  // Between clips there is no word at all (narration-store's currentWord is
  // null until the next clip plays), so the marker clears rather than
  // lingering on, or jumping back within, the previous passage.
  //
  // Even when the key matches, this still re-applies the class if the
  // element it's supposedly already on isn't actually connected/marked
  // anymore — BackToCurrentButton's jump (and any other cross-section
  // navigation) remounts BookContent's active-section subtree entirely
  // (key={section.id}), which tears down and recreates every passage
  // span. Nothing about *which word* is playing changes when that happens,
  // so the key alone wouldn't notice — but the freshly-mounted span never
  // got the class applied to it, which is what read as the highlight
  // vanishing (or freezing on nothing) right after using that button.
  const narratingWordElRef = useRef<Element | null>(null);
  const narratingWordKeyRef = useRef<string>("");
  //
  // The word comes from useNarratedWord: your own narration's, or the one a
  // speaker in this book's live room is reading aloud (which is why the
  // section is looked up from the passage rather than taken from narration).
  const narratedSectionId = narratedWord ? passageLookup.sectionOf.get(narratedWord.passageId) : undefined;
  useEffect(() => {
    if (!narratedWord || !narratedSectionId) {
      narratingWordElRef.current?.classList.remove("om-narrating-word");
      narratingWordElRef.current = null;
      narratingWordKeyRef.current = "";
      return;
    }
    const idx = narratedWord.index;
    const key = `${narratedWord.passageId}:${idx}`;
    const alreadyCorrect =
      key === narratingWordKeyRef.current &&
      narratingWordElRef.current?.isConnected &&
      narratingWordElRef.current.classList.contains("om-narrating-word");
    if (alreadyCorrect) return;
    narratingWordKeyRef.current = key;
    narratingWordElRef.current?.classList.remove("om-narrating-word");
    const passageEl = getSlideEl(narratedSectionId)?.querySelector(`[data-passage-id="${narratedWord.passageId}"]`);
    const el = passageEl?.querySelector(`[data-word-index="${idx}"]`) ?? null;
    el?.classList.add("om-narrating-word");
    narratingWordElRef.current = el;
  }, [narratedWord, narratedSectionId, getSlideEl]);

  // Whether the actual passage element currently narrating is scrolled into
  // view — distinct from isFollowingNarration, which only tracks the
  // section-level carousel position. A long chapter is exactly where these
  // two disagree: the reader can be sitting on the *same* section
  // (isFollowingNarration stays true) while having scrolled several
  // screens away from the one passage actually playing, with nothing today
  // offering a way back short of hunting for it. Tracked via
  // IntersectionObserver against the section's own scroll container (the
  // same element getSlideEl already returns), not scroll-position math —
  // it fires once per actual visibility change rather than on every scroll
  // event, and `entry.boundingClientRect`/`rootBounds` hand back exactly
  // the "which side did it leave from" comparison the up/down arrow needs.
  const [passageInView, setPassageInView] = useState(true);
  const [passageOffscreenDirection, setPassageOffscreenDirection] = useState<"up" | "down">("down");
  useEffect(() => {
    if (!isListen || !currentPlayingPassageId || !narrationAudioSection) {
      setPassageInView(true);
      return;
    }
    const container = getSlideEl(narrationAudioSection.id);
    const el = container?.querySelector(`[data-passage-id="${currentPlayingPassageId}"]`);
    if (!container || !el) {
      setPassageInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setPassageInView(entry.isIntersecting);
        if (!entry.isIntersecting && entry.rootBounds) {
          setPassageOffscreenDirection(entry.boundingClientRect.top < entry.rootBounds.top ? "up" : "down");
        }
      },
      { root: container, threshold: 0.01 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isListen, currentPlayingPassageId, narrationAudioSection, getSlideEl]);

  // "Back to narration" — the nudge that appears once the reader has
  // manually turned away from whichever passage is actually playing, either
  // by leaving its section entirely (!isFollowingNarration) or by scrolling
  // past it within the same long section (!passageInView). Only makes
  // sense while listening: audio playing somewhere is a plain fact to
  // navigate back to, unlike plain reading (no playback, just a
  // resume-position guess) where the same nudge would read as the app
  // second-guessing a reader who may have turned away on purpose.
  const awayFromNarration = isListen && (!isFollowingNarration || !passageInView);
  // Cross-section direction (a real spine-order comparison) takes priority
  // over the in-section IntersectionObserver reading when both could apply
  // — !isFollowingNarration is already the coarser, more reliable signal of
  // the two.
  const nudgeDirection: "up" | "down" = !isFollowingNarration
    ? narrationAudioIndex < activeIndex
      ? "up"
      : "down"
    : passageOffscreenDirection;
  const jumpToNarration = useCallback(() => {
    goTo(narrationAudioIndex, { animate: false });
    if (!currentPlayingPassageId || !narrationAudioSection) return;
    requestAnimationFrame(() => {
      getSlideEl(narrationAudioSection.id)
        ?.querySelector(`[data-passage-id="${currentPlayingPassageId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [goTo, narrationAudioIndex, currentPlayingPassageId, narrationAudioSection, getSlideEl]);

  const activeSectionForSidebar = activeSectionId ?? book.spine[0];
  const prevSection = orderedSections[activeIndex - 1];
  const nextSection = orderedSections[activeIndex + 1];
  const getPassageText = useCallback(
    (passageId: string) => passageLookup.byId.get(passageId)?.text ?? "",
    [passageLookup]
  );
  // Listen on a selection: narration from its first word.
  const listenFrom = useCallback(
    (passageId: string, offset: number) => {
      const passage = passageLookup.byId.get(passageId);
      const sectionId = passageLookup.sectionOf.get(passageId);
      if (!passage || !sectionId) return;
      // Narration counts words in the spoken text (note markers dropped).
      const spoken = spokenPassageText({
        ...passage,
        text: passage.text.slice(0, offset),
        marks: passage.marks?.filter((m) => m.end <= offset),
      });
      const wordIndex = wordIndexAt(spoken, spoken.length);
      if (isListen) seekToPassageForListening(sectionId, passageId, wordIndex);
      else openBookAtPassage(liveBook, materialId, sectionId, passageId, wordIndex);
    },
    [passageLookup, isListen, seekToPassageForListening, openBookAtPassage, liveBook, materialId]
  );
  const onInternalLinkClick = useCallback(
    (sectionId: string, fragmentId?: string) => {
      // A link mark's sectionId can resolve to a navigation label rather
      // than real content (e.g. an EPUB TOC entry pointing at a Part
      // header) — navigateToSection lands on the nearest actual reading
      // section instead. The in-slide fragment scroll below still targets
      // the *original* sectionId/fragmentId, since that's only meaningful
      // when the link did resolve straight to real content; when it
      // didn't, that querySelector simply finds nothing and the scroll is
      // skipped, leaving the reader at the top of the section they landed on.
      navigateToSection(sectionId, { animate: false });
      requestAnimationFrame(() => {
        const slide = getSlideEl(sectionId);
        if (!slide) return;
        const fragment = fragmentId ? fragmentId.replace(/^#/, "") : "";
        const target =
          (fragment ? slide.querySelector(`[data-passage-id="${fragment}"]`) : null) ??
          slide.querySelector(`[data-passage-id="${sectionId}"]`);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [navigateToSection, getSlideEl]
  );
  // Same "navigate, then scroll within the freshly-mounted slide a frame
  // later" idiom already used identically by useResumeScroll, the
  // narration-follow effect, and SearchModal's own onNavigate — centers on
  // the exact highlighted span (not just the top of its passage), since
  // that's the thing the reader actually followed here to see.
  //
  // A passage can hold more than one distinct highlight though, so landing
  // on the passage alone doesn't say which range was clicked — that's what
  // justJumpedAnnotationId + .reader-jump-flash (PassageContent.tsx,
  // globals.css) are for: the initial pulse is a one-shot 2.4s CSS
  // animation, but it settles into (and holds, `animation-fill-mode:
  // forwards`) the ordinary steady wash rather than fading out — so
  // whichever panel sent the reader here (the book-wide feed's quote
  // cards, or a deep link's own note thread) can keep that wash live for
  // as long as *it* stays open, not just for the animation's own runtime.
  // That's what the effect below this actually clears it on: neither panel
  // still open, not a timer. No toast; the flash+held wash is confirmation
  // enough on its own.
  const [justJumpedAnnotationId, setJustJumpedAnnotationId] = useState<string | null>(null);
  useEffect(() => {
    if (!notesPanel && !noteFeed.open) setJustJumpedAnnotationId(null);
  }, [notesPanel, noteFeed.open]);
  const jumpToFeedEntry = (entry: FeedEntry) => {
    goToSection(entry.sectionId, { animate: false });
    requestAnimationFrame(() => {
      getSlideEl(entry.sectionId)
        ?.querySelector(`[data-annotation-id="${entry.annotation.id}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setJustJumpedAnnotationId(entry.annotation.id);
  };

  // Opens a specific annotation's thread exactly the way clicking its
  // inline marker already does (closing the book feed first, so the two
  // notes surfaces never fight for the same panel slot) — shared by that
  // real marker click below and by the deep-link effect further down, so
  // there's exactly one implementation of "open this annotation".
  //
  // `keepHeaderVisible` is what tells chromeVisible (below) whether this
  // particular notesPanel open should still hide the header the normal way.
  // A reader who taps a marker mid-book already has full context for where
  // they are, so the header tucking away to give the notes panel room is
  // the right call there. A reader who just arrived via the home feed's
  // deep link has none of that yet — the header (with its close button and
  // book title) is the only thing orienting them in a book they didn't
  // choose to open themselves, so it stays up despite the same notesPanel
  // being open. Defaults to false rather than a second wrapper function, so
  // there's still exactly one "open this annotation" implementation, not two.
  const openNoteMarker = (
    passageId: string,
    annotationId: string,
    opts?: { keepHeaderVisible?: boolean; targetThreadId?: string }
  ) => {
    noteFeed.close();
    onNoteMarkerClick(passageId, annotationId, { targetThreadId: opts?.targetThreadId });
    setNotesPanelKeepsHeader(Boolean(opts?.keepHeaderVisible));
  };

  // Arriving from an external deep link (the home community feed) that
  // names a specific note — once the reader has actually landed on the
  // right passage (isReady, same gate the loader itself waits on), open
  // that annotation's thread the same way clicking its marker would. A
  // ref guard keeps this to once per page load, same idiom as
  // FeedPanel's own once-on-open positioning effect.
  //
  // useResumeScroll only lands on the *passage's* top (block: "start") —
  // it has no notion of which highlight within that passage the reader
  // actually followed the link for. This re-centers on the exact
  // [data-annotation-id] span and flashes it, same as jumpToFeedEntry does
  // for in-reader jumps, so a deep link into a long passage doesn't strand
  // the reader above the highlight it promised.
  const hasOpenedTargetNoteRef = useRef(false);
  useEffect(() => {
    if (hasOpenedTargetNoteRef.current) return;
    if (!isReady || !targetSectionId || !targetPassageId || !targetNoteId) return;
    hasOpenedTargetNoteRef.current = true;
    requestAnimationFrame(() => {
      getSlideEl(targetSectionId)
        ?.querySelector(`[data-annotation-id="${targetNoteId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setJustJumpedAnnotationId(targetNoteId);
    openNoteMarker(targetPassageId, targetNoteId, {
      keepHeaderVisible: true,
      targetThreadId: targetThreadId,
    });
    // The centering scroll above is a *programmatic* jump, but
    // useSectionCarousel's own scroll listener (lib/reader/useSectionCarousel.ts)
    // can't tell that apart from the reader scrolling themselves — a downward
    // jump (the annotation sitting below the passage's start) flips
    // chromeHidden true mid-animation, undoing keepHeaderVisible a moment
    // after it was just set. This is what made the header's visibility feel
    // inconsistent: whether it stuck depended on how far the jump had to
    // scroll. Reasserting it once more, after the smooth scroll has had time
    // to settle, is what makes keepHeaderVisible actually win.
    const chromeReassertTimeout = setTimeout(() => setChromeHidden(false), 500);
    return () => clearTimeout(chromeReassertTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately fires once, when isReady first becomes true with both target props present; openNoteMarker/onNoteMarkerClick/getSlideEl/setChromeHidden close over stable-enough identity for this one-shot purpose.
  }, [isReady, targetSectionId, targetPassageId, targetNoteId]);

  // General (unanchored) note deep link from push notifications — has no
  // passage to scroll to, so it opens the book-wide feed panel instead of
  // the per-passage thread. Mirrors the anchored deep-link effect above but
  // targets the feed. Fires once, only when isReady and the general note id
  // is present and no anchored deep link is also active.
  const hasOpenedGeneralNoteRef = useRef(false);
  useEffect(() => {
    if (hasOpenedGeneralNoteRef.current) return;
    if (!isReady || !targetGeneralNoteId) return;
    if (targetNoteId) return; // anchored link takes precedence
    hasOpenedGeneralNoteRef.current = true;
    // Close per-passage thread if open — the two panels share the same slot.
    if (notesPanel) closeNotesPanel();
    // Ensure the notes tab is visible — general notes never appear under
    // "Your highlights".
    noteFeed.setFilter("notes");
    noteFeed.openFeed();
    // Header should stay visible for an externally-triggered deep link —
    // same reasoning as keepHeaderVisible for anchored notes.
    setChromeHidden(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot deep-link effect
  }, [isReady, targetGeneralNoteId, targetNoteId]);

  const onNoteClick = useCallback((note: NoteLookup, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setNoteOpen({
      note,
      top: rect.bottom + 6,
      left: Math.min(window.innerWidth - 336, Math.max(8, rect.left - 140)),
    });
  }, []);

  // The outline (and, same reasoning, the notes panel) forces the header
  // away for as long as either is open (rather than trying to reserve/
  // track the header's own scroll-driven show/hide, which left a dead gap
  // when the two states disagreed) — the underlying chromeHidden scroll
  // tracking keeps running regardless, so closing either one returns to
  // whatever visibility plain scrolling would already have produced.
  // notesPanelKeepsHeader is the one exception to "notes panel open ⇒ hide
  // header" — see openNoteMarker's own comment.
  // Shared by both header and footer: any of these panels being open takes
  // over the chrome regardless of scroll state, so neither bar should show
  // (or be forced onto the screen by, e.g., ChapterNavFooter's own
  // reached-the-bottom trigger below) while one is up.
  const chromeOverlaysOpen =
    chaptersOpen || (notesPanel && !notesPanelKeepsHeader) || noteFeed.open;
  const chromeVisible = !chromeHidden && !chromeOverlaysOpen;
  // ChapterNavFooter's own visibility: same scroll-up/click trigger as the
  // header (chromeVisible), OR'd with "reached the bottom of this section"
  // — so the nav still surfaces on its own right when there's actually
  // somewhere to go next, even if the reader scrolled straight down without
  // ever triggering the header's reveal. atBottom is deliberately not
  // gated on chromeHidden (only on the overlays) so that arriving at the
  // bottom always shows it regardless of scroll direction.
  const footerVisible = !chromeOverlaysOpen && (!chromeHidden || atBottom);
  const railInsetPx = isMobile ? 12 : 16;
  // Bumped from the old single-line top bar to fit a book-title +
  // current-section subtitle now that the icon rail has merged into it.
  const topBarHeightPx = isMobile ? 60 : 64;
  // Static now rather than conditional on chromeVisible: the header is a
  // fixed overlay that can reappear over the content at any moment on
  // upward scroll, so the scroll area always reserves their space instead
  // of the content reflowing underneath them when they're hidden.
  // Desktop reserves a 40px gutter for the paragraph play control; on
  // mobile the control is hidden (globals.css) so paragraphs use the full
  // width with a tighter inset.
  const contentPad = "px-4 shell:px-10";
  const contentTopPad = topBarHeightPx + (isMobile ? 28 : 48);
  // Reserves room for the docked ChapterNavFooter — a floating overlay
  // (like the header) that only surfaces once the reader reaches the
  // bottom of the section, so the last bit of text isn't covered when it
  // slides into view.
  // Bumped from 88 — ChapterNavFooter now also pads itself for the
  // home-indicator safe area on notched phones, so it can render a bit
  // taller there than this used to assume.
  const contentBottomPad = isMobile ? 104 : 96;

  // This reader as a live room sees it (lib/room/view.ts): following,
  // the margin and the speaker band, once the reader has landed. Rebuilt
  // when the section on screen changes, which tells the room you moved
  // (a section turn needn't scroll).
  const [readingArea, setReadingArea] = useState<HTMLDivElement | null>(null);
  const epubScale = useMemo(() => buildEpubScale(book), [book]);
  const roomView = useMemo(
    () =>
      isReady && readingArea
        ? epubView({
            materialId,
            mode: isListen ? "listen" : "read",
            root: readingArea,
            topInset: () => topBarHeightPx,
            scale: epubScale,
            section: (id) => sectionsById.get(id),
            goToSection: (id) => goToSection(id, { animate: false }),
            sectionLabel: (id) => {
              const section = sectionsById.get(id);
              return section ? sectionLabel(section) : null;
            },
            surface: () => selectionSurface,
          })
        : null,
    // activeSectionId: a section turn is a move, so it's a new view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isReady, readingArea, materialId, isListen, topBarHeightPx, epubScale, goToSection, sectionsById, selectionSurface, activeSectionId]
  );
  useRoomView(roomView, selection?.ranges ?? null);

  return (
    <div
      data-reader-theme={theme}
      // h-dvh, not h-screen (100vh): mobile Safari's 100vh is the height
      // with its own bottom toolbar collapsed, i.e. taller than what's
      // actually visible while that toolbar is showing — this container's
      // real height came out larger than the visible viewport, so
      // ChapterNavFooter (absolute, pinned to *its* bottom edge) rendered
      // partly or fully below the fold behind Safari's own chrome. 100dvh
      // tracks the actual visible viewport live as the toolbar shows/hides.
      // overflow-clip, not -hidden, here and on the wrappers below: a hidden
      // box can still be scrolled from code, so the reader's scrollIntoView
      // (re-centring a passage, e.g. as the room panel opens) used to shift
      // the whole frame up — header and panel with it. Clip can't scroll.
      className="reader-typography w-full h-dvh box-border flex flex-col overflow-clip relative font-sans"
      style={typographyStyle}
    >
      <div className="flex-1 min-h-0 relative overflow-clip">
        <ReaderHeader
          visible={chromeVisible}
          topBarHeightPx={topBarHeightPx}
          railInsetPx={railInsetPx}
          onClose={onClose}
          canListen={canListen}
          isListen={isListen}
          onListen={() => openBook(liveBook, materialId)}
          onToggleSearch={() => setSearchOpen((o) => !o)}
          activeSection={orderedSections[activeIndex]}
          onToggleChapters={() => setChaptersOpen((o) => !o)}
        />

        {/* Chapters drawer, content column, and notes panel live side by
            side — both drawers are persistent push-drawers (flex siblings
            with an animated width) on desktop, not scrim overlays, so
            opening either narrows the reading column instead of blocking
            it. See the notes panel's own comment below for its mobile
            fallback (a bottom sheet, since there's no room to push there). */}
        <div className="w-full h-full flex overflow-clip">
          <ChaptersDrawer
            book={liveBook}
            scrollPct={scrollPct}
            activeSectionId={activeSectionForSidebar}
            isMobile={isMobile}
            open={chaptersOpen}
            // In listen mode this needs to behave like the audio player's
            // own skip buttons — jump narration there and start playing —
            // rather than just scrolling this page while playback carries
            // on wherever it already was. Plain reading keeps the old
            // scroll-only navigation.
            //
            // Deliberately only jumpNarrationToSection here, not also a
            // direct navigateToSection call: an earlier version called
            // both, on the theory that the carousel needed its own explicit
            // push since the auto-follow effect above only followed when
            // already-following. That meant two independent places each
            // deciding "what section is the reader looking at" for the
            // same click — this component's own activeIndex state, and
            // NarrationEngine's target/narration-store — racing each
            // other, which produced real "page unresponsive" hangs. The
            // fix was in the reconciler itself (NarrationEngine's
            // explicitJumpSeq, which the auto-follow effect above now
            // checks), not a second navigation call site here: this jump
            // (like the skip buttons and word clicks) is now always
            // followed by that one effect, without this needing to know
            // anything about the carousel at all.
            onNavigate={(id) => (isListen ? jumpNarrationToSection(id) : navigateToSection(id, { animate: false }))}
            onClose={() => setChaptersOpen(false)}
          />

          {/* Content column — no dimming while the chapters sheet is open
              (that opacity dip was a leftover from the old full-screen
              slide-in outline, which made sense to shadow the reader
              behind it; the outline is a partial bottom sheet now,
              specifically so the reader stays visible/scrollable behind
              it — same as the notes panel, which never dimmed this
              either). */}
          <div ref={setReadingArea} className="flex-1 min-w-0 h-full flex flex-col relative" style={{ background: "var(--reader-bg)" }}>
            <BookContent
              book={book}
              activeIndex={activeIndex}
              registerSlide={registerSlide}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onAnyClick={() => setChromeHidden((hidden) => !hidden)}
              contentPad={contentPad}
              contentTopPad={contentTopPad}
              contentBottomPad={contentBottomPad}
              orderedSections={orderedSections}
              endSlot={endSlot}
              notesIndexSectionId={notesIndexSectionId}
              notesIndexGroups={notesIndexGroups}
              getAnnotations={getAnnotations}
              notesById={notesById}
              onNoteClick={onNoteClick}
              onInternalLinkClick={onInternalLinkClick}
              onNoteMarkerClick={openNoteMarker}
              justJumpedAnnotationId={justJumpedAnnotationId}
              onPassagePlayback={canListen ? handlePassagePlayback : undefined}
              currentPlayingPassageId={isListen ? currentPlayingPassageId : undefined}
              trackNarrationWords={isListen || roomOnThisBook}
              isNarrationPlaying={isListen && audioIsPlaying}
            />

            <ChapterNavFooter
              prevSection={prevSection}
              nextSection={nextSection}
              onPrev={prev}
              onNext={next}
              // Also hidden for as long as a selection is active — on
              // mobile the selection pill is itself a fixed bottom bar (see
              // SelectionMenu.tsx), and would otherwise land directly on
              // top of this one if the reader selects text right at the
              // end of a section — and for as long as any audio player is
              // active, since its own skip-prev/skip-next chapter buttons
              // (NarrationEngine's skipToPrevSection/skipToNextSection)
              // already cover this footer's whole job, and stacking both
              // just doubles up the same affordance right above the "now
              // playing" bar.
              visible={footerVisible && !selection && !anyPlayerActive}
              // Under the room's mini-player, which floats above it.
              bottomOffsetPx={narrationBarHeight}
            />

            {/* Selection menu is a fixed-position overlay, so it doesn't need
                to live inside BookContent's scrollable tree; keeping it here
                means selecting text never forces the (memoized) book content
                to re-render. Selecting text (some or all of an existing
                mark, or fresh) is the only way to reach the full action set
                — Highlight/Note/Copy/Delete; clicking an existing mark
                instead (PassageContent's onNoteMarkerClick) just opens its
                thread directly, no menu. */}
                
            {selectionOverlay}
            {shareQuote.modal}
            <SelectionActions
              materialId={materialId}
              selection={selection}
              overlay={overlay}
              getPassageText={getPassageText}
              locationLabel={(passageId) => locateFeedEntry(passageId)?.label ?? ""}
              hasExistingAnnotation={hasExistingAnnotation}
              onHighlight={highlightSelection}
              onNote={() => {
                noteFeed.close();
                noteFromSelection();
              }}
              onDelete={deleteSelection}
              onDismiss={dismissSelection}
              onDismissOverlay={dismissOverlay}
              onListenFrom={canListen ? listenFrom : undefined}
              onShare={shareQuote.share}
              onSharedToRoom={() => {
                if (notesPanel) closeNotesPanel();
                noteFeed.openRoom();
              }}
            />

            {searchOpen && (
              <div className="absolute inset-0 z-50">
                <SearchModal
                  book={liveBook}
                  onNavigate={(sectionId, passageId) => {
                    goToSection(sectionId, { animate: false });
                    requestAnimationFrame(() => {
                      getSlideEl(sectionId)
                        ?.querySelector(`[data-passage-id="${passageId}"]`)
                        ?.scrollIntoView({ behavior: "auto", block: "center" });
                    });
                  }}
                  onClose={() => setSearchOpen(false)}
                />
              </div>
            )}

            {noteOpen && (
              <FootnotePopover
                note={noteOpen.note}
                top={noteOpen.top}
                left={noteOpen.left}
                onClose={() => setNoteOpen(null)}
              />
            )}

          </div>

          {/* Notes panel — a push-drawer on desktop (mirrors ChaptersDrawer,
              opposite side: a flex sibling with an animated width that
              narrows the content column instead of floating over it) and a
              non-blocking bottom-sheet overlay on mobile, where there's no
              room to push sideways. The shell: breakpoint (not the
              isMobile prop) is what picks between them, same reasoning as
              ChaptersDrawer's own: isMobile is false on every first render
              and only flips after mount, so a JS-gated swap here would
              flash the wrong layout for a frame. Always mounted (even with
              nothing to show) so the width can actually transition instead
              of popping open/closed. */}
          <div
            className={`fixed inset-0 z-[70] overflow-clip pointer-events-none shell:static shell:inset-auto shell:h-full shell:flex-none shell:transition-[width] shell:duration-300 shell:ease-out ${
              notesPanel || noteFeed.open ? "shell:w-95" : "shell:w-0"
            }`}
          >
            {noteFeed.open && (
              <FeedPanel
                materialId={materialId}
                items={noteFeed.items}
                notes={noteFeed.notes}
                filter={noteFeed.filter}
                onFilterChange={noteFeed.setFilter}
                activeSectionId={activeSectionId}
                onJump={jumpToFeedEntry}
                getPassageText={getPassageText}
                panelType={isMobile ? "sheet" : "side"}
                onClose={noteFeed.close}
                targetNoteId={targetGeneralNoteId}
                targetThreadId={targetThreadId ?? targetGeneralNoteId}
                focusedAuthor={noteFeed.focusedAuthor}
                onClearAuthor={noteFeed.clearAuthor}
              />
            )}
            {notesPanel && (
              <NotesSidebar
                // Forces a remount whenever the panel switches to a
                // different thread — e.g. clicking straight from one note
                // marker to another without closing the panel first — so
                // EditPanel's own state (its drill-down stack in
                // particular) can't leak from one thread's view into
                // another's.
                key={notesPanel.annotationId ?? JSON.stringify(notesPanel.ranges)}
                materialId={materialId}
                passageId={notesPanel.passageId}
                getPassageText={getPassageText}
                annotationId={notesPanel.annotationId}
                pendingRanges={notesPanel.ranges}
                editingNoteId={notesPanel.editingNoteId}
                targetThreadId={notesPanel.targetThreadId}
                panelType={isMobile ? "sheet" : "side"}
                onClose={closeNotesPanel}
                onShare={shareQuote.share}
              />
            )}
          </div>
        </div>
      </div>

      {currentPlayingPassageId && awayFromNarration && (
        <BackToCurrentButton bottom={dockedHeight + 16} direction={nudgeDirection} onClick={jumpToNarration} />
      )}

      <NotesFeedFab
        materialId={materialId}
        feed={noteFeed}
        activeSectionId={activeSectionId}
        closeNotesPanel={closeNotesPanel}
        // Same lifecycle as ChapterNavFooter itself, not an independent
        // always-on FAB — see NotesFeedFab's own doc comment. Deliberately
        // not also gated on !anyPlayerActive the way the footer's own
        // `visible` is: the rail stays reachable while listening too.
        visible={footerVisible && !selection}
        scrolledAway={chromeHidden && !atBottom}
      />

      {/* Masks the reader until theme/font/position (hydrated) and scroll
          position (resumeReady) all reflect real saved state, so nothing
          the reader would notice snapping into place is ever visible.
          confined: stays inside this wrapper's own absolute inset-0 rather
          than Loader's normal fixed-to-viewport default — see Loader's own
          doc comment for why that matters specifically inside ReaderModal.
          Kept mounted (not conditionally rendered) so the opacity
          transition actually plays.
          transition-[opacity,visibility]: `visibility` is not a "no self-
          transition" static prop swap here — its toggle rides the same
          duration-300 as opacity, so it flips at the END of the fade
          instead of the instant `isReady` flips. Without that, a deep link
          that opens straight into a note (e.g. its citation's "See more")
          mounted underneath this mask the same render `isReady` goes true
          was clickable through the still-visibly-fading overlay, because a
          plain `pointer-events-none` swaps immediately regardless of the
          opacity transition's own duration. */}
      <div
        aria-hidden={isReady}
        className={`absolute inset-0 z-[100] transition-[opacity,visibility] duration-300 ${
          isReady ? "opacity-0 invisible" : "opacity-100 visible"
        }`}
      >
        <Loader confined />
      </div>
    </div>
  );
}
