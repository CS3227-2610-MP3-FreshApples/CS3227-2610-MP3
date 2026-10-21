export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ReportCategory = "profanity" | "harassment" | "hate" | "spam" | "other";
export type ReportStatus = "open" | "dismissed" | "accepted";
export type ReportReceipt = Readonly<{ id: string; reviewId: string; category: ReportCategory; status: ReportStatus; disposition?: "accepted" | "dismissed"; createdAt: string }>;
export type ReportPage = Readonly<{ items: readonly ReportReceipt[]; page: number; pageSize: number; total: number }>;
export type ReportFailure = Readonly<{ ok: false; message: string; fieldErrors?: Readonly<Record<string, readonly string[]>> }>;
export type ReportResult<T> = Readonly<{ ok: true; value: T }> | ReportFailure;
export type ReportInput = Readonly<{ reviewId: string; category: ReportCategory; explanation: string }>;

const PAGE_SIZE = 20;
const GENERIC_FAILURE = "We could not complete that report request. Please try again.";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function isCategory(value: unknown): value is ReportCategory { return value === "profanity" || value === "harassment" || value === "hate" || value === "spam" || value === "other"; }
function isReceipt(value: unknown): value is ReportReceipt {
  const receipt = record(value);
  return receipt !== null && isUuid(receipt.id) && isUuid(receipt.reviewId) && isCategory(receipt.category) && (receipt.status === "open" || receipt.status === "dismissed" || receipt.status === "accepted") && (receipt.disposition === undefined || receipt.disposition === "accepted" || receipt.disposition === "dismissed") && isIsoDate(receipt.createdAt);
}
function isPage(value: unknown): value is ReportPage {
  const page = record(value);
  return page !== null && Array.isArray(page.items) && page.items.every(isReceipt) && typeof page.page === "number" && Number.isInteger(page.page) && page.page >= 1 && typeof page.pageSize === "number" && Number.isInteger(page.pageSize) && page.pageSize >= 1 && page.pageSize <= 100 && typeof page.total === "number" && Number.isInteger(page.total) && page.total >= 0;
}
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function isIsoDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value)); }
function fieldErrors(value: unknown): Readonly<Record<string, readonly string[]>> | undefined {
  const error = record(value)?.error;
  const fields = record(error)?.fieldErrors;
  if (fields === null || fields === undefined || typeof fields !== "object" || Array.isArray(fields)) return undefined;
  const result: Record<string, readonly string[]> = {};
  for (const [key, messages] of Object.entries(fields as Record<string, unknown>)) {
    if (Array.isArray(messages) && messages.every((message) => typeof message === "string")) result[key] = messages;
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function failureFor(response: Response, body?: unknown): ReportFailure {
  if (response.status === 401) return { ok: false, message: "Your session has ended. Sign in again to continue." };
  if (response.status === 403) return { ok: false, message: "Your account cannot submit reports right now." };
  if (response.status === 409) return { ok: false, message: "This review has already been reported or is no longer available." };
  if (response.status === 422) return { ok: false, message: "Check the report category and explanation, then try again.", ...(fieldErrors(body) ? { fieldErrors: fieldErrors(body) } : {}) };
  if (response.status === 429) return { ok: false, message: "You have submitted several reports recently. Please try again later." };
  return { ok: false, message: GENERIC_FAILURE };
}

export async function listOwnReports(page: number, fetcher: Fetcher = fetch): Promise<ReportResult<ReportPage>> {
  try {
    const response = await fetcher(`/api/v1/me/reports?page=${page}&pageSize=${PAGE_SIZE}`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return failureFor(response, response.status === 422 ? await response.json().catch(() => undefined) : undefined);
    const body: unknown = await response.json();
    return isPage(body) ? { ok: true, value: body } : { ok: false, message: GENERIC_FAILURE };
  } catch { return { ok: false, message: GENERIC_FAILURE }; }
}

export async function submitReport(input: ReportInput, fetcher: Fetcher = fetch): Promise<ReportResult<ReportReceipt>> {
  try {
    const csrfResponse = await fetcher("/api/v1/auth/csrf", { cache: "no-store", credentials: "same-origin" });
    if (!csrfResponse.ok) return failureFor(csrfResponse);
    const csrfToken = record(await csrfResponse.json())?.csrfToken;
    if (typeof csrfToken !== "string" || csrfToken.length === 0) return { ok: false, message: GENERIC_FAILURE };
    const response = await fetcher("/api/v1/reports", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify(input) });
    if (!response.ok) return failureFor(response, response.status === 422 ? await response.json().catch(() => undefined) : undefined);
    const body: unknown = await response.json();
    return response.status === 201 && isReceipt(body) ? { ok: true, value: body } : { ok: false, message: GENERIC_FAILURE };
  } catch { return { ok: false, message: GENERIC_FAILURE }; }
}

export function pageFromSearchParam(value: string | readonly string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}
export function formatReportDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`; }
export function reportCategoryLabel(category: ReportCategory): string { return category[0].toUpperCase() + category.slice(1); }
