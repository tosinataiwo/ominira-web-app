"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { MessageCircle, PenLine, Plus } from "lucide-react";
import ReaderAvatar from "@/app/components/shared/ReaderAvatar";
import { comradeName } from "@/lib/reader/authorDisplay";
import { pseudonymToSlug } from "@/lib/reader/profileSlug";
import { useProfile } from "@/lib/auth/useProfile";
import { LiveBadge, LiveMark, compact, notesLabel, usePresence, type Live } from "./ReaderPresence";
import { avatarRingColor, type Avatar } from "@/lib/avatar/avatar";
import type { BookAnnotationFeed, NoteAuthor } from "@/lib/reader/useBookAnnotationFeed";

type Props = {
  materialId: string;
  /** The book's notes feed (useBookAnnotationFeed) — the rail reads its
   * authors and count, and opens it: toggled from the chat bubble, narrowed
   * to one comrade from their card. Every format hands over its own feed and
   * this does the rest, so the rail behaves the same in all of them. */
  feed: BookAnnotationFeed;
  /** The run the reader is in, so whoever wrote there leads the faces. */
  activeSectionId?: string;
  /** Closes the per-thread notes panel — it shares the feed's slot, so the
   * feed opening takes it over. */
  closeNotesPanel: () => void;
  /** Same lifecycle as the rest of the reader chrome in every format (EPUB's
   * ChapterNavFooter, useScrollChrome in the document readers) — a
   * persistent, always-on FAB turned out to undercut the distraction-free
   * reading experience per reader feedback, so this shows/hides on
   * scroll-up/tap/reaching-the-bottom exactly like the rest of the reader
   * chrome instead of staying on screen through it. */
  visible: boolean;
  /** The reader scrolled the chrome away — folds the rail down to the bare
   * FAB. Distinct from `visible`, which also drops for a selection or an
   * open overlay, neither of which should fold it. */
  scrolledAway?: boolean;
};

type Face = {
  readerId: string;
  pseudonym: string;
  avatar: Avatar | null;
  place: string | null;
  /** Every note they wrote in the book — 0 for a reader who's only reading. */
  noteCount: number;
  /** Where they wrote, when not here — the first run's label. */
  wroteIn: string | null;
  wroteHere: boolean;
  /** Currently reading/listening, and how. */
  live: Live | null;
};

type Bubble = { title: ReactNode; detail: string | false };

const MAX_FACES = 3;
/** How long the greeting stays out. */
const INTRO_MS = 5500;
/** Lets the faces pop in before the message joins them. */
const INTRO_DELAY_MS = 700;
const CARD_MS = 6000;

// The greeting is just that, not a notification — once per book per
// visit to the app, so paging back and forth never replays it.
const introduced = new Set<string>();

/**
 * The reader's social rail — the people behind a book's notes, a column
 * docked to the middle of the right edge on desktop, the way Substack hangs
 * a post's outline beside the text, and a row at the right above the bottom bar
 * on phones, where there's no margin to hang it in. Faces lead, in order of relevance: whoever
 * wrote in the run the reader is in, whoever is currently reading the book,
 * then whoever wrote elsewhere.
 *
 * It borrows its language from the social apps readers already know: a
 * gradient story ring on anyone with an unopened note here (grey once you've
 * opened it), a pinging dot on anyone currently reading and a tiny
 * equaliser on anyone listening — the only things that move, and only
 * because they're true. The chat icon carries the book's note count as a
 * badge. Tapping a face opens their card — who they are, where they read
 * from, what they're doing, how many notes they left — and tapping the card
 * opens the notes panel on just their notes.
 *
 * The first time the rail is opened in a book, a short message says who's
 * here ("3 currently reading · Comrade Ada wrote here") and tucks away again. With nobody else
 * here the open rail is just the chat bubble and the reader's own face.
 *
 * "Currently reading" is fetched once on arrival (usePresence) — a snapshot
 * for social proof, not a live roster.
 *
 * `env(safe-area-inset-right)` keeps it clear of the notch on phones held
 * sideways — a no-op everywhere else.
 */
export default function NotesFeedFab({
  materialId,
  feed,
  activeSectionId,
  closeNotesPanel,
  visible,
  scrolledAway = false,
}: Props) {
  const noteAuthors = feed.noteAuthors(activeSectionId);
  const noteCount = feed.totalNoteCount;
  const onOpenAuthor = (readerId: string) => {
    closeNotesPanel();
    feed.openFeed(readerId);
  };
  const onOpenFeed = () => {
    if (feed.open) return feed.close();
    closeNotesPanel();
    feed.openFeed();
  };
  const { data: me } = useProfile();
  const presence = usePresence(materialId);
  // Folded on arrival in every format — just the reader's own seat, nothing
  // between them and the text. Tapping it opens the rail; closing it or
  // scrolling the chrome away folds it back.
  const [folded, setFolded] = useState(true);
  const [wasScrolledAway, setWasScrolledAway] = useState(scrolledAway);
  if (scrolledAway !== wasScrolledAway) {
    setWasScrolledAway(scrolledAway);
    if (scrolledAway) setFolded(true);
  }

  const readerById = new Map(presence.others.map((r) => [r.readerId, r]));
  const faces: Face[] = [];
  const add = (f: Face) => {
    if (!faces.some((x) => x.readerId === f.readerId)) faces.push(f);
  };
  const fromAuthor = ({ author, entries, here, count }: NoteAuthor): Face => {
    const r = readerById.get(author.readerId);
    return {
      readerId: author.readerId,
      pseudonym: author.pseudonym,
      avatar: author.avatar,
      place: r?.city ?? author.city ?? null,
      noteCount: count,
      wroteIn: here ? null : (entries[0]?.label ?? null),
      wroteHere: here,
      live: r?.mode ?? null,
    };
  };
  for (const a of noteAuthors) if (a.here) add(fromAuthor(a));
  for (const r of presence.others) {
    const wrote = noteAuthors.find((a) => a.author.readerId === r.readerId);
    add(
      wrote
        ? fromAuthor(wrote)
        : { ...r, place: r.city ?? null, noteCount: 0, wroteIn: null, wroteHere: false, live: r.mode }
    );
  }
  for (const a of noteAuthors) add(fromAuthor(a));
  const shown = faces.slice(0, MAX_FACES);
  const writersHere = noteAuthors.filter((a) => a.here);

  // Whose notes you've opened — their story ring goes grey.
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const [card, setCard] = useState<Face | null>(null);
  useEffect(() => {
    if (!card) return;
    const t = setTimeout(() => setCard(null), CARD_MS);
    return () => clearTimeout(t);
  }, [card]);

  // Waits for presence so the message describes who's actually here, and
  // for the rail to be on screen so it isn't spent while nobody's looking.
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    if (!visible || !presence.isFetched || folded || introduced.has(materialId)) return;
    const t = setTimeout(() => {
      introduced.add(materialId);
      setIntro(true);
    }, INTRO_DELAY_MS);
    return () => clearTimeout(t);
  }, [visible, presence.isFetched, folded, materialId]);
  useEffect(() => {
    if (!intro) return;
    const t = setTimeout(() => setIntro(false), INTRO_MS);
    return () => clearTimeout(t);
  }, [intro]);

  const toggleCard = (f: Face) => {
    setIntro(false);
    setCard(card?.readerId === f.readerId ? null : f);
  };
  const openCard = (f: Face) => {
    setCard(null);
    setSeen(new Set(seen).add(f.readerId));
    onOpenAuthor(f.readerId);
  };

  const notesLine = noteCount > 0 && `${notesLabel(noteCount)} in this book`;
  const writersLine =
    writersHere.length > 0 &&
    `${comradeName(writersHere[0].author.pseudonym)}${
      writersHere.length > 1 ? ` and ${writersHere.length - 1} ${writersHere.length === 2 ? "other" : "others"}` : ""
    } wrote here`;
  const liveWord = presence.anyReading ? "reading" : "listening";

  const bubble: Bubble | null =
    intro && !folded && !card
      ? presence.count > 0
        ? {
            title: (
              <>
                <LiveMark live={presence.anyReading ? "read" : "listen"} />
                {compact(presence.count)} currently {liveWord}
              </>
            ),
            detail: writersLine || notesLine,
          }
        : writersLine
          ? { title: writersLine, detail: notesLine }
          : null
      : null;

  const summary = [notesLine, presence.count > 0 && `${presence.count} currently ${liveWord}`].filter(Boolean).join(", ");

  const overflow = faces.length - shown.length;
  const badge = noteCount > 0 && (
    <span className="reader-face-in absolute right-0 top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[var(--reader-accent)] px-1 text-[10px] font-bold leading-none tabular-nums text-[var(--reader-bg)] ring-2 ring-[var(--reader-surface)]">
      {noteCount > 99 ? "99+" : noteCount}
    </span>
  );

  return (
    <div
      className={`fixed z-40 transition-[scale,opacity] duration-200 ease-out ${
        folded ? "right-[calc(2px+env(safe-area-inset-right))]" : "right-[calc(16px+env(safe-area-inset-right))]"
      } shell:right-[calc(16px+env(safe-area-inset-right))] bottom-[calc(76px+env(safe-area-inset-bottom))] shell:bottom-auto shell:top-1/2 shell:-translate-y-1/2 ${
        visible ? "scale-100 opacity-100" : "scale-95 opacity-0 pointer-events-none"
      }`}
    >
      {card && <ProfileCard key={card.readerId} face={card} onOpen={() => openCard(card)} />}

      {bubble && (
        <button
          onClick={() => {
            setIntro(false);
            onOpenFeed();
          }}
          aria-live="polite"
          className={`${FLOAT} flex max-w-[15rem] cursor-pointer flex-col gap-0.5 rounded-sm px-3.5 py-2.5 text-left`}
        >
          <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[12px] font-bold leading-tight text-[var(--reader-text)]">
            {bubble.title}
          </span>
          {bubble.detail && (
            <span className="truncate text-[12px] font-semibold leading-tight text-[var(--reader-text-muted)]">{bubble.detail}</span>
          )}
        </button>
      )}

      {folded ? (
        // Folded, the rail is the reader's own seat at the table — just their
        // face, ring and "+", no pill around it (smaller and tucked further
        // right on phones). Tapping it brings the rail back; the open rail's
        // × folds it again.
        <button
          onClick={() => setFolded(false)}
          aria-label={`Show readers — ${summary}`}
          aria-expanded={false}
          title="Show readers"
          className="reader-face-in group flex cursor-pointer items-center rounded-full p-1 transition-transform duration-150 hover:scale-[1.03] active:scale-95"
        >
          <span className="reader-story-ring relative flex-none origin-bottom-right scale-[0.75] shell:scale-100">
            <MyFace me={me} />
          </span>
        </button>
      ) : (
        // Open: the faces stack (overlapping, like a group chat's) and the
        // chat bubble, then the reader's own face — the same seat as the
        // folded FAB, in the same place, its "+" turned into a × that folds
        // it back. A column docked to the right edge on desktop, a row
        // above the bottom bar on phones.
        <div
          role="group"
          aria-label={summary}
          className="reader-glass relative flex flex-row items-center gap-2 rounded-full border border-[var(--reader-border)] p-2 shell:flex-col"
        >
          {shown.length > 0 && (
            <>
              <div className="flex flex-row items-center shell:flex-col">
                {shown.map((f, i) => (
                  <button
                    key={f.readerId}
                    onClick={() => toggleCard(f)}
                    aria-label={faceLabel(f)}
                    aria-expanded={card?.readerId === f.readerId}
                    title={faceLabel(f)}
                    style={{ animationDelay: `${i * 70}ms`, zIndex: MAX_FACES + 1 - i }}
                    className={`reader-face-in relative cursor-pointer rounded-full transition-transform duration-150 hover:z-10 hover:scale-105 active:scale-95 ${
                      i > 0 ? "-ml-2 shell:ml-0 shell:-mt-2" : ""
                    }`}
                  >
                    <span
                      className="reader-story-ring block"
                      data-plain={(f.live !== "read" && !f.wroteHere) || undefined}
                      data-seen={(f.live !== "read" && f.wroteHere && seen.has(f.readerId)) || undefined}
                    >
                      <ReaderAvatar
                        pseudonym={f.pseudonym}
                        avatar={f.avatar}
                        size={32}
                        className="ring-2 ring-[var(--reader-surface)]"
                      />
                    </span>
                    {f.live === "listen" && <LiveBadge live={f.live} className="absolute bottom-0 right-0" />}
                  </button>
                ))}
                {overflow > 0 && (
                  // A member of the stack, not a notification tally — "+12"
                  // reads as twelve more comrades.
                  <button
                    onClick={onOpenFeed}
                    aria-label={`${overflow} more ${overflow === 1 ? "comrade" : "comrades"}`}
                    title={`${overflow} more`}
                    style={{ animationDelay: `${MAX_FACES * 70}ms` }}
                    className="reader-face-in relative -ml-2 flex h-9 w-9 flex-none cursor-pointer items-center justify-center rounded-full border border-[var(--reader-accent)] bg-[color-mix(in_srgb,var(--reader-accent)_12%,var(--reader-surface))] text-[11px] font-bold tabular-nums text-[var(--reader-accent)] ring-2 ring-[var(--reader-surface)] transition-transform duration-150 hover:scale-105 active:scale-95 shell:ml-0 shell:-mt-2"
                  >
                    +{compact(overflow)}
                  </button>
                )}
              </div>
            </>
          )}

          <button
            onClick={onOpenFeed}
            aria-label={noteCount > 0 ? `Open all ${notesLabel(noteCount)}` : "Leave the first note"}
            title={noteCount > 0 ? "Open all notes" : "Leave the first note"}
            className="relative flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-full text-[var(--reader-text-muted)] transition-colors hover:bg-[var(--reader-surface-hover)]"
          >
            <MessageCircle size={21} strokeWidth={2} />
            {badge}
          </button>

          <span aria-hidden="true" className="h-6 w-px bg-[var(--reader-border)] shell:h-px shell:w-6" />
          <button
            onClick={() => {
              setCard(null);
              setIntro(false);
              setFolded(true);
            }}
            aria-label="Hide readers"
            aria-expanded={true}
            title="Hide"
            className="group relative flex-none cursor-pointer rounded-full transition-transform duration-150 active:scale-95"
          >
            <span className="reader-story-ring relative block">
              <MyFace me={me} open />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Where anything floating off the rail sits: above it, right-aligned, on phones;
 * to its left, level with its middle, on desktop. */
const FLOAT =
  "reader-glass reader-menu-in absolute bottom-full right-0 mb-2.5 shell:bottom-auto shell:right-full shell:top-1/2 shell:mb-0 shell:mr-2.5 shell:-translate-y-1/2";

/** A comrade's card, opened from their face: who they are and where they
 * read from on one line, what they're doing under it, and — when they've
 * left any — a muted note count under that, which opens them. */
function ProfileCard({ face, onOpen }: { face: Face; onOpen: () => void }) {
  const name = comradeName(face.pseudonym);
  const status = face.live
    ? { text: face.live === "listen" ? "Currently listening" : "Currently reading", live: face.live }
    : { text: face.wroteHere ? "Wrote here" : `Wrote in ${face.wroteIn || "this book"}`, live: null };
  const profileHref = `/@${pseudonymToSlug(face.pseudonym)}`;

  return (
    <div
      role="dialog"
      aria-label={name}
      className={`${FLOAT} flex w-64 max-w-[calc(100vw-2rem)] flex-col rounded-sm p-3.5 text-left`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <ReaderAvatar pseudonym={face.pseudonym} avatar={face.avatar} size={40} className="flex-none" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-[12px] leading-tight">
            <Link
              href={profileHref}
              className="font-semibold capitalize text-[var(--reader-text)] no-underline hover:underline"
            >
              {name}
            </Link>
            {face.place && <span className="text-[var(--reader-text-muted)] font-semibold"> · {face.place}</span>}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium text-[var(--reader-text-muted)]">
            {status.live && <LiveMark live={status.live} />}
            {status.text}
          </span>
          {face.noteCount > 0 && (
            <button
              onClick={onOpen}
              className="w-fit cursor-pointer border-none bg-transparent p-0 text-left text-[11.5px] font-bold text-[var(--reader-text-muted)] hover:text-[var(--reader-text)] hover:underline"
            >
              {notesLabel(face.noteCount)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The reader's own seat at the table — their avatar with a "+" — the
 * rail's fold toggle, the "+" turning into a × while it's open. */
function MyFace({ me, open = false }: { me: ReturnType<typeof useProfile>["data"]; open?: boolean }) {
  return (
    <>
      {me ? (
        <ReaderAvatar
          pseudonym={me.pseudonym}
          avatar={me.avatar}
          size={34}
          className="ring-[1.5px]"
          style={{ "--tw-ring-color": avatarRingColor(me.pseudonym, me.avatar) } as CSSProperties}
        />
      ) : (
        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--reader-surface)] text-[var(--reader-accent)]">
          <PenLine size={16} />
        </span>
      )}
      <span className={`absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--reader-accent)] text-[var(--reader-bg)] ring-2 ring-[var(--reader-surface)] transition-transform duration-300 ease-out ${
          open ? "rotate-45 group-hover:rotate-[135deg]" : "group-hover:rotate-90"
        }`}>
        <Plus size={11} strokeWidth={3.5} />
      </span>
    </>
  );
}

function faceLabel(f: Face) {
  const name = comradeName(f.pseudonym);
  if (f.live) return `${name} is currently ${f.live === "listen" ? "listening" : "reading"}`;
  if (f.wroteHere) return `${name} wrote here`;
  return `${name} wrote in ${f.wroteIn || "this book"}`;
}
