// Mirrors api-spec.md's "Shared Types" section exactly — these are the
// camelCase JSON shapes every route handler below serializes to. Nothing
// snake_case ever reaches the client (api-spec.md's Conventions).

import type { CoverSource } from "@/lib/materials/image";
import type { Locator, ReaderMode } from "@/lib/reader/locator";
import type { Avatar } from "@/lib/avatar/avatar";

/**
 * One comrade currently reading or listening to a material — the roster entry
 * shape shared by MaterialSummary, MaterialDetail and lib/reader/activity.ts's
 * own listCurrentReaders (defined once here, since it's an API contract).
 */
export type CurrentReaderSummary = {
  readerId: string;
  pseudonym: string;
  avatar: Avatar;
  /** Whether their most recent activity was reading or listening — drives the
   * roster's mode icon. */
  mode: ReaderMode;
  updatedAt: string;
  /** Where they read from, as set on their profile — the social rail's
   * profile card shows it. Null when they left it blank. */
  city: string | null;
  country: string | null;
};

/** One block's share of a highlight or note. `passageId` names the block in the
 * surface's own terms — an EPUB passage id, a PDF page ("pdf:p12"), a paragraph
 * of an article — and start/end are character offsets into that block's text
 * (see lib/annotations/surface.ts). `text` is the quoted slice itself: stored
 * so the feed can show the quote for formats the server can't re-read (every
 * format but EPUB, whose book the server has); never part of a range's
 * identity (sameRanges/rangesKey ignore it). */
export type AnnotationRange = { passageId: string; start: number; end: number; text?: string };

export type NoteContent =
  | { kind: "text"; text: string }
  | { kind: "voice"; audioUrl: string; durationMs: number };

export type NoteVisibility = "public" | "private";

export type MaterialSummary = {
  id: string;
  slug: string;
  materialType: string;
  title: string;
  author: string;
  description: string | null;
  cover: string | null;
  thumbnail: string | null;
  googleCoverUrl: string | null;
  googleThumbnailUrl: string | null;
  /** Google's own book blurb — see BookDetailView's `googleDescription ??
   * openlibraryDescription` cascade, which this mirrors; `description`
   * above (first-party) is left out of that cascade, it isn't reliably
   * populated. */
  googleDescription: string | null;
  openlibraryCoverUrl: string | null;
  openlibraryThumbnailUrl: string | null;
  openlibraryDescription: string | null;
  coverSource: CoverSource;
  language: string | null;
  publishedYear: number | null;
  pageCountEstimate: number | null;
  categories: string[];
  /**
   * Comrades currently reading/listening to this material
   * (`reader_activities`), most recently active first, capped (lib/reader/
   * constants.ts's CURRENT_READERS_DISPLAY_CAP for a list page,
   * CURRENT_READERS_DETAIL_CAP for a single book-detail page) — see
   * lib/reader/activity.ts's listCurrentReaders. Empty on a MaterialSummary
   * `toMaterialSummary` built directly (its own safe default) — only
   * `listPublishedMaterials`/`getMaterialDetail` actually enrich this.
   */
  currentReaders: CurrentReaderSummary[];
  /** Real count of active readers — may exceed currentReaders.length once
   * the display cap kicks in; that gap is exactly the UI's "+N more". */
  currentReaderCount: number;
  /** Reader who uploaded this into their personal library — null for the
   * editorial catalog (see reader-uploads-spec.md). */
  uploadedBy: string | null;
  visibility: "personal" | "public";
};

export type Note = {
  id: string;
  /** Null for a book-less discussion post (HomeComposer's plain "what's on
   * your mind" posts, `thread_type: 'discussion'` with no attached book) —
   * every book-anchored note/reply still always has one. */
  materialId: string | null;
  author: { readerId: string; pseudonym: string; city: string | null; avatar: Avatar | null };
  ranges: AnnotationRange[];
  parentId: string | null;
  replyingToId: string | null;
  content: NoteContent;
  visibility: NoteVisibility;
  reactionCount: number;
  reactedByMe: boolean;
  /** Whether the caller has saved this post (migrations/20261003_bookmarks
   * .sql). No matching count: unlike a reaction, a bookmark is private, so
   * there's no public total to carry. False for a signed-out caller. */
  bookmarkedByMe: boolean;
  /** The post's default topic name — always topicNames[0] (migrations/
   * 20260919_topics_and_posts.sql's required topic_id), null only if the
   * topic lookup itself failed. Surfaced so AuthorRow can show "· in
   * {topicName}". */
  topicName: string | null;
  /** topicName's own slug — lets AuthorRow link the topic label straight
   * into Home's `?topic=<slug>` filter (CategoryPills' own href shape),
   * without a client-side name->slug lookup. Null exactly when topicName
   * is. */
  topicSlug: string | null;
  /** Every topic the post is tagged under, default first (migrations/
   * 20260927_post_topics.sql) — a reader can tag a post under several
   * topics via the composer's multi-select picker. Empty only alongside a
   * null topicName. */
  topicNames: string[];
  /** Same set as topicNames, name+slug pairs — what AuthorRow actually
   * renders (every tagged topic, each linked into Home's `?topic=<slug>`
   * filter), rather than just the default. */
  topics: { name: string; slug: string }[];
  createdAt: string;
  updatedAt: string;
};

export type NoteThread = { note: Note; replies: Note[] };

export type Highlight = {
  id: string;
  materialId: string;
  readerId: string;
  ranges: AnnotationRange[];
  createdAt: string;
  updatedAt: string;
};

/**
 * One `reader_activities` row — a reader's position in one material, in any
 * format (`locator`, see lib/reader/locator.ts) and either mode. Not embedded
 * on ReaderProfile (nothing read that field; see
 * GET /api/auth/me/continue-reading for the enriched, sorted view of these).
 */
export type CurrentReadingEntry = {
  materialId: string;
  locator: Locator;
  mode: ReaderMode;
  /** Playback offset within the located passage — only ever set in listen
   * mode, and only once a clip has actually played. */
  audioTimeMs: number | null;
  /** 0-100, computed from `locator` by whoever wrote it (`locatorPercent`).
   * Never reaches 100 on its own — see `positionPercent`/`finishedAt`. */
  progressPercent: number;
  /** When this reader explicitly marked the material finished, or null.
   * Completion is its own fact, not a threshold on `progressPercent` (see
   * lib/reader/locator.ts's positionPercent). */
  finishedAt: string | null;
  updatedAt: string;
};

/**
 * `materials.toc`'s own shape (api-spec.md § Materials) — deliberately
 * lighter than `lib/book/schema.ts`'s `Section`: `label`/`passageCount` are
 * *resolved* values computed once at publish time, specifically so a
 * DB-only consumer (the book-detail page) never needs passage content to
 * render a chapter list or a progress bar.
 */
export type TocSection = {
  id: string;
  label: string | null;
  kind: "front" | "body" | "back" | "unknown";
  passageCount: number;
  children: TocSection[];
  audioDurationMs?: number;
  narratorIds?: string[];
};

export type ReaderAgeRange = "13_17" | "18_24" | "25_34" | "35_44" | "45_54" | "55_64" | "65_plus";

export type ReaderProfile = {
  id: string;
  email: string;
  fullName: string;
  pseudonym: string;
  city: string | null;
  country: string | null;
  interests: string[];
  surveyReadMaterialIds: string[];
  /** Optional — the survey lets a reader skip demographic questions entirely. */
  ageRange: ReaderAgeRange | null;
  /** Free text, capped at 40 chars — no fixed list of options (lib/auth/profile.ts). */
  genderIdentity: string | null;
  onboardingStatus: "pending_survey" | "pending_welcome" | "active";
  avatar: Avatar;
  /** Opted in to admin email announcements (off by default). */
  emailAnnouncements: boolean;
  /** Approved by an admin to upload books (/admin/readers), or an admin. */
  canUpload: boolean;
  joinedAt: string;
  updatedAt: string;
};
