import { useSessionStore, type Session } from "@/stores/session-store";
import type { ApiErrorCode } from "@/lib/api/errors";

// Refresh a bit before the access token's actual expiry, not exactly at it —
// leaves room for the request that's about to use this token to still land
// server-side before it goes stale.
const REFRESH_MARGIN_MS = 60_000;

// Concurrent calls into getValidAccessToken while a refresh is already in
// flight all await this same promise rather than each firing their own
// POST /api/auth/refresh — a burst of queries on app load (or reconnect)
// refreshes the session exactly once, not once per query.
let refreshPromise: Promise<RefreshOutcome> | null = null;

/**
 * Three-way, not a plain Session-or-null: "the refresh token is confirmed
 * dead" (`revoked`) and "that attempt just didn't land" (`transient`) used
 * to collapse into the same `null` and both hard-signed the reader out —
 * which meant a dropped network request (very common right after a PWA
 * cold-resumes on iOS, before the OS has actually reconnected) was enough
 * to end a session that had nothing wrong with it. Only `revoked` may ever
 * clear session-store; `transient` leaves the existing session in place so
 * the next attempt (next call, next app open) gets to retry.
 */
type RefreshOutcome = { session: Session } | { revoked: true } | { transient: true };

async function refreshSession(refreshToken: string): Promise<RefreshOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Never reached our own API — says nothing about the refresh token's
    // actual validity.
    return { transient: true };
  }
  if (res.ok) return { session: ((await res.json()) as { session: Session }).session };
  // /api/auth/refresh itself only ever answers 401 once Supabase has
  // confirmed the token is genuinely invalid (see that route) — anything
  // else (a 5xx, a hiccup) isn't a verdict on the token.
  return res.status === 401 ? { revoked: true } : { transient: true };
}

/**
 * The access token stored in session-store lives far shorter than a reader
 * should have to stay actively signed in for (Supabase's own default is
 * ~1h) — this is what actually keeps a reader logged in across days/weeks:
 * transparently exchanges the long-lived refresh token for a new access
 * token whenever the stored one is expired or about to be, updating
 * session-store in place. A refresh token that's itself no longer valid
 * (revoked, or truly stale) clears the session outright, same as an
 * explicit log-out — there's nothing left worth retrying.
 */
export async function ensureFreshSession({ force = false } = {}): Promise<string | undefined> {
  const session = useSessionStore.getState().session;
  if (!session) return undefined;

  const expiresAtMs = Date.parse(session.expiresAt);
  const stillFresh = !Number.isNaN(expiresAtMs) && expiresAtMs - Date.now() > REFRESH_MARGIN_MS;
  if (stillFresh && !force) return session.accessToken;

  if (!refreshPromise) {
    refreshPromise = refreshSession(session.refreshToken).finally(() => {
      refreshPromise = null;
    });
  }
  const outcome = await refreshPromise;

  if ("session" in outcome) {
    const readerId = useSessionStore.getState().readerId;
    if (readerId) {
      useSessionStore.getState().setSession(readerId, outcome.session);
      return outcome.session.accessToken;
    }
  }
  if ("revoked" in outcome) {
    // The refresh token itself is no good any more — nothing left to try;
    // treat this exactly like an explicit sign-out rather than silently
    // keeping a dead session around.
    useSessionStore.getState().clearSession();
    return undefined;
  }
  // Transient — keep the existing session rather than signing the reader
  // out over what might just be a dropped request. Its access token is
  // stale, so a call made with it may itself 401, but that's a single
  // request retried on the next attempt, not a lost session.
  return session.accessToken;
}

/** Client-side mirror of lib/api/errors.ts's `{ error: { code, message,
 * field } }` shape (api-spec.md's Conventions) — thrown instead of returned
 * so every query/mutation hook can rely on TanStack Query's own
 * error-handling (`isError`/`error` on the hook result) rather than each
 * call site re-checking a response envelope by hand. */
export class ApiError extends Error {
  status: number;
  code: ApiErrorCode | "unknown";
  field?: string;

  constructor(status: number, code: ApiErrorCode | "unknown", message: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

type ApiFetchOptions = {
  method?: string;
  /** JSON-serializable request body — stringified and sent with a
   * `Content-Type: application/json` header. Mutually exclusive with `body`
   * (raw bytes — only `POST /api/community/voice-notes` needs that today). */
  json?: unknown;
  body?: BodyInit;
  headers?: HeadersInit;
};

/**
 * The one fetch wrapper every query/mutation hook calls into — attaches
 * `Authorization: Bearer <token>` from session-store whenever a session
 * exists (most GETs work fine without one; api-spec.md's Conventions list
 * exactly which routes actually require it, enforced server-side regardless
 * of whether this header is sent), and parses a non-2xx response into a
 * typed ApiError instead of every caller re-checking `res.ok` itself.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method, json, body, headers } = options;
  const send = (accessToken: string | undefined) =>
    fetch(`/api${path}`, {
      method: method ?? (json !== undefined || body !== undefined ? "POST" : "GET"),
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
    });

  const accessToken = await ensureFreshSession();
  let res = await send(accessToken);
  // An access token can be rejected before it expires (e.g. one signed by
  // the previous Supabase project): refresh once and retry.
  if (res.status === 401 && accessToken) {
    const refreshed = await ensureFreshSession({ force: true });
    if (refreshed && refreshed !== accessToken) res = await send(refreshed);
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data?.error as { code?: ApiErrorCode; message?: string; field?: string } | undefined) ?? {};
    throw new ApiError(res.status, err.code ?? "unknown", err.message ?? "Something went wrong.", err.field);
  }
  return data as T;
}

/** Pulls an inline, field-level message off a caught error for a specific
 * form input (api-spec.md's Conventions: `field` is only ever present when
 * an error is attributable to one input) — `undefined` for every other
 * error shape, so a form-level banner (see `errorMessage` below) is what
 * renders instead. */
export function fieldError(error: unknown, field: string): string | undefined {
  return error instanceof ApiError && error.field === field ? error.message : undefined;
}

/** The form-level fallback for an error with no `field` (e.g. login's
 * deliberately generic 401) — rendered as an inline banner near the form,
 * never a redirect/toast. */
export function errorMessage(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || error.field) return undefined;
  return error.message;
}
