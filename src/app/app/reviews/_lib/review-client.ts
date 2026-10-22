export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ReviewFailure = Readonly<{ ok: false; message: string }>;
export type ReviewResult<T> = Readonly<{ ok: true; value: T }> | ReviewFailure;

export type OwnReviewView = Readonly<{
  id: string;
  movieId: string;
  author: Readonly<{ id: string; displayName: string }>;
  rating: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  moderationState: "pending" | "flagged" | "cleared";
  version: number;
}>;

export type ReviewPage = Readonly<{ items: readonly OwnReviewView[]; page: number; pageSize: number; total: number }>;

const PAGE_SIZE = 20;

export function pageFromSearchParam(value: string | readonly string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isOwnReview(value: unknown): value is OwnReviewView {
  const review = record(value);
  const author = review === null ? null : record(review.author);
  return review !== null
    && typeof review.id === "string"
    && typeof review.movieId === "string"
    && author !== null
    && typeof author.id === "string"
    && typeof author.displayName === "string"
    && Number.isInteger(review.rating)
    && typeof review.body === "string"
    && typeof review.createdAt === "string"
    && typeof review.updatedAt === "string"
    && typeof review.version === "number"
    && Number.isSafeInteger(review.version)
    && review.version >= 1
    && (review.moderationState === "pending" || review.moderationState === "flagged" || review.moderationState === "cleared");
}

function isReviewPage(value: unknown): value is ReviewPage {
  const page = record(value);
  return page !== null
    && Array.isArray(page.items)
    && page.items.every(isOwnReview)
    && Number.isInteger(page.page)
    && Number.isInteger(page.pageSize)
    && Number.isInteger(page.total);
}

function failureFor(response: Response): ReviewFailure {
  if (response.status === 401) return { ok: false, message: "Your session has ended. Sign in again to continue." };
  if (response.status === 403) return { ok: false, message: "Your account cannot view reviews right now." };
  return { ok: false, message: "We could not load your reviews. Please try again." };
}

export async function listOwnReviews(page: number, fetcher: Fetcher = fetch): Promise<ReviewResult<ReviewPage>> {
  try {
    const response = await fetcher(`/api/v1/me/reviews?page=${page}&pageSize=${PAGE_SIZE}`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return failureFor(response);
    const body: unknown = await response.json();
    return isReviewPage(body) ? { ok: true, value: body } : { ok: false, message: "We could not load your reviews. Please try again." };
  } catch {
    return { ok: false, message: "We could not load your reviews. Please try again." };
  }
}

export type OwnReviewMutationInput = Readonly<{ rating?: number; body?: string }>;

export async function updateOwnReview(reviewId: string, version: number, input: OwnReviewMutationInput, fetcher: Fetcher = fetch): Promise<ReviewResult<OwnReviewView>> {
  try {
    const csrfResponse = await fetcher("/api/v1/auth/csrf", { cache: "no-store", credentials: "same-origin" });
    if (!csrfResponse.ok) return { ok: false, message: "Your session has ended. Sign in again to continue." };
    const csrfBody = record(await csrfResponse.json());
    if (typeof csrfBody?.csrfToken !== "string") return { ok: false, message: "We could not prepare your review. Please try again." };
    const response = await fetcher(`/api/v1/reviews/${encodeURIComponent(reviewId)}`, {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "If-Match": `"${version}"`, "X-CSRF-Token": csrfBody.csrfToken },
      method: "PATCH",
    });
    if (!response.ok) return { ok: false, message: response.status === 409 ? "This review changed. Reload it before saving again." : "We could not save your review. Please try again." };
    const body: unknown = await response.json();
    return isOwnReview(body) ? { ok: true, value: body } : { ok: false, message: "We could not save your review. Please try again." };
  } catch {
    return { ok: false, message: "We could not save your review. Please try again." };
  }
}

export function formatReviewDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
