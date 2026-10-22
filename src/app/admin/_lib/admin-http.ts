// Browser-side access to the /api/v1/admin endpoints. Client Components use this instead of src/server
// (architecture 6.6); every response is treated as untrusted and checked before use.

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export type AdminFailureKind =
  | "validation"
  | "stale"
  | "conflict"
  | "not_found"
  | "unauthenticated"
  | "forbidden"
  | "rate_limited"
  | "unavailable";

export type AdminFailure = Readonly<{
  ok: false;
  kind: AdminFailureKind;
  message: string;
  fieldErrors?: FieldErrors;
}>;

export type AdminResult<T> = Readonly<{ ok: true; value: T }> | AdminFailure;

export type AdminAccount = Readonly<{
  displayName: string;
  role: "ADMIN";
  status: "active";
}>;

export type LogoutResult = Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>;

export type ListPage<T> = Readonly<{
  items: readonly T[];
  page: number;
  pageSize: number;
  total: number;
}>;

/** A mutation request. `version` becomes the If-Match precondition (api.md 8.1). */
export type AdminMutation = Readonly<{
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  version?: number;
}>;

const MESSAGES: Record<AdminFailureKind, string> = {
  validation: "Please correct the highlighted fields and try again.",
  stale: "Someone changed this record after you loaded it. Nothing was saved. Load the latest version, then try again.",
  conflict: "This change is not allowed in the record’s current state. Nothing was saved.",
  not_found: "This record no longer exists.",
  unauthenticated: "Your session has ended. Sign in again to continue.",
  forbidden: "Only active Admins can use this page.",
  rate_limited: "Too many requests. Please wait a moment and try again.",
  unavailable: "The service is temporarily unavailable. Refresh the page to check the current state before trying again.",
};

const CSRF_FAILED_MESSAGE = "Your security check expired. Reload the page and try again.";

export function failure(kind: AdminFailureKind, fieldErrors?: FieldErrors): AdminFailure {
  return fieldErrors === undefined
    ? { ok: false, kind, message: MESSAGES[kind] }
    : { ok: false, kind, message: MESSAGES[kind], fieldErrors };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readFieldErrors(value: unknown): FieldErrors | undefined {
  const errors = record(value);
  if (errors === null) return undefined;
  const result: Record<string, readonly string[]> = {};
  for (const [field, messages] of Object.entries(errors)) {
    if (Array.isArray(messages) && messages.every((message) => typeof message === "string")) result[field] = messages;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

async function readErrorBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return record(record(await response.json())?.error);
  } catch {
    return null;
  }
}

function isAdminAccount(value: unknown): value is AdminAccount {
  const account = record(value);
  return account !== null
    && typeof account.displayName === "string"
    && account.role === "ADMIN"
    && account.status === "active";
}

/** Maps an API error response (api.md 8.1 error contract) to a safe, user-facing failure. */
export async function failureFromResponse(response: Response): Promise<AdminFailure> {
  const error = await readErrorBody(response);
  const code = error?.code;
  switch (response.status) {
    case 401:
      return failure("unauthenticated");
    case 403:
      return code === "csrf_failed" ? { ok: false, kind: "forbidden", message: CSRF_FAILED_MESSAGE } : failure("forbidden");
    case 404:
      return failure("not_found");
    case 409:
      return code === "stale_version" ? failure("stale") : failure("conflict");
    case 422:
      return failure("validation", readFieldErrors(error?.fieldErrors));
    case 429:
      return failure("rate_limited");
    default:
      return failure("unavailable");
  }
}

/** Reads the integer row version from a strong ETag such as `"3"`. */
export function versionFromEtag(etag: string | null): number | null {
  const match = etag === null ? null : /^"(\d+)"$/.exec(etag);
  return match === null ? null : Number(match[1]);
}

export function isListPage<T>(value: unknown, isItem: (item: unknown) => item is T): value is ListPage<T> {
  const page = record(value);
  return page !== null
    && Array.isArray(page.items)
    && page.items.every(isItem)
    && Number.isInteger(page.page)
    && Number.isInteger(page.pageSize)
    && Number.isInteger(page.total);
}

/** GETs an Admin resource; `parse` rejects any body that does not match the expected projection. */
export async function adminRead<T>(path: string, parse: (body: unknown) => body is T, fetcher: Fetcher): Promise<AdminResult<T>> {
  try {
    const response = await fetcher(path, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return failureFromResponse(response);
    const body: unknown = await response.json();
    return parse(body) ? { ok: true, value: body } : failure("unavailable");
  } catch {
    return failure("unavailable");
  }
}

async function csrfToken(fetcher: Fetcher): Promise<string | null> {
  const response = await fetcher("/api/v1/auth/csrf", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return null;
  const token = record(await response.json())?.csrfToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** Reads the active Admin projection used by the Admin shell. */
export async function getAdminAccount(fetcher: Fetcher): Promise<AdminResult<AdminAccount>> {
  try {
    const response = await fetcher("/api/v1/auth/me", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return failureFromResponse(response);
    const body: unknown = await response.json();
    return isAdminAccount(body) ? { ok: true, value: body } : failure("unavailable");
  } catch {
    return failure("unavailable");
  }
}

/** Logs out an Admin through the same CSRF-aware request sequence as other Admin mutations. */
export async function adminLogout(fetcher: Fetcher, replace: (href: string) => void): Promise<LogoutResult> {
  try {
    const token = await csrfToken(fetcher);
    if (token === null) return { ok: false, message: "We couldn’t sign you out right now. Please try again." };
    const response = await fetcher("/api/v1/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": token },
    });
    if (response.status !== 204) return { ok: false, message: "We couldn’t sign you out right now. Please try again." };
    replace("/sign-in");
    return { ok: true };
  } catch {
    return { ok: false, message: "We couldn’t sign you out right now. Please try again." };
  }
}

/**
 * Sends one mutation with a fresh CSRF token (S-04) and, when a version is given, If-Match. `accept`
 * turns a 2xx response into the result value, or null when the response is not the expected shape.
 */
export async function adminWrite<T>(
  mutation: AdminMutation,
  accept: (response: Response) => Promise<T | null>,
  fetcher: Fetcher,
): Promise<AdminResult<T>> {
  try {
    const token = await csrfToken(fetcher);
    if (token === null) return failure("unavailable");
    const headers: Record<string, string> = { "X-CSRF-Token": token };
    if (mutation.body !== undefined) headers["Content-Type"] = "application/json";
    if (mutation.version !== undefined) headers["If-Match"] = `"${mutation.version}"`;
    const response = await fetcher(mutation.path, {
      method: mutation.method,
      cache: "no-store",
      credentials: "same-origin",
      headers,
      ...(mutation.body === undefined ? {} : { body: JSON.stringify(mutation.body) }),
    });
    if (!response.ok) return failureFromResponse(response);
    const value = await accept(response);
    return value === null ? failure("unavailable") : { ok: true, value };
  } catch {
    return failure("unavailable");
  }
}

/** Accepts a JSON body that matches `parse`. */
export function jsonBody<T>(parse: (body: unknown) => body is T): (response: Response) => Promise<T | null> {
  return async (response) => {
    const body: unknown = await response.json();
    return parse(body) ? body : null;
  };
}

/** Accepts a 204 and returns the resulting version from its ETag (D-81). */
export async function noContentVersion(response: Response): Promise<number | null> {
  return response.status === 204 ? versionFromEtag(response.headers.get("ETag")) : null;
}

export const ADMIN_PAGE_SIZE = 20;

export function pageQuery(page: number): string {
  return `page=${page}&pageSize=${ADMIN_PAGE_SIZE}`;
}

/** Reads `?page=` from a page's searchParams; anything but a positive integer is page 1. */
export function pageFromSearchParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw !== undefined && /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : 1;
}

/** ISO 8601 UTC timestamp → "2026-10-20 08:15 UTC"; the API always sends UTC (api.md 8.1). */
export function formatUtc(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return record(value) !== null;
}
