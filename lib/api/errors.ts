import { NextResponse } from "next/server";

// The one error shape every non-2xx response uses (api-spec.md's Conventions).
// `field` is present only when an error is attributable to one specific form
// input — the client renders those inline, never as a redirect.
export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "conflict"
  // Reading Room join refusals the client renders as states (spec §10).
  | "room_full"
  | "room_ended";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  conflict: 409,
  room_full: 409,
  room_ended: 410,
};

export function apiError(code: ApiErrorCode, message: string, field?: string) {
  return NextResponse.json({ error: { code, message, ...(field ? { field } : {}) } }, { status: STATUS_BY_CODE[code] });
}

export const unauthorized = (message = "Sign in required.") => apiError("unauthorized", message);
export const forbidden = (message = "You don't have access to this.") => apiError("forbidden", message);
export const notFound = (message = "Not found.") => apiError("not_found", message);
export const validationError = (message: string, field?: string) => apiError("validation_error", message, field);
export const conflict = (message: string, field?: string) => apiError("conflict", message, field);
