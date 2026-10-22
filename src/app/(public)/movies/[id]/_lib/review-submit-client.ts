export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ReviewSubmissionInput = Readonly<{ rating: number; body: string }>;
export type OwnMovieReview = Readonly<{ id: string; movieId: string; author: Readonly<{ id: string; displayName: string }>; rating: number; body: string; createdAt: string; updatedAt: string; moderationState: "pending" | "flagged" | "cleared"; version: number }>;
export type ReviewSubmissionValue = OwnMovieReview & Readonly<{ message: string }>;
export type ReviewSubmissionResult = Readonly<{ ok: true; value: ReviewSubmissionValue }> | Readonly<{ ok: false; message: string }>;
export type ReviewUpdateResult = ReviewSubmissionResult;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isSubmission(value: unknown): value is ReviewSubmissionValue {
  const result = record(value);
  const author = result === null ? null : record(result.author);
  return result !== null
    && typeof result.id === "string"
    && typeof result.movieId === "string"
    && author !== null
    && typeof author.id === "string"
    && typeof author.displayName === "string"
    && Number.isInteger(result.rating)
    && typeof result.body === "string"
    && typeof result.createdAt === "string"
    && typeof result.updatedAt === "string"
    && (result.moderationState === "pending" || result.moderationState === "flagged" || result.moderationState === "cleared")
    && typeof result.version === "number"
    && Number.isSafeInteger(result.version)
    && result.version >= 1
    && typeof result.message === "string";
}

function isReviewPage(value: unknown): value is { items: readonly OwnMovieReview[] } {
  const page = record(value);
  return page !== null && Array.isArray(page.items) && page.items.every((item) => isSubmission({ ...item, message: "" }));
}

function failureFor(status: number): string {
  if (status === 401) return "Sign in to submit a review.";
  if (status === 403) return "Your account cannot submit a review right now.";
  if (status === 422) return "Check your rating and review, then try again.";
  if (status === 429) return "You have submitted several reviews recently. Please try again later.";
  return "We could not submit your review. Please try again.";
}

export async function submitReview(movieId: string, input: ReviewSubmissionInput, fetcher: Fetcher = fetch): Promise<ReviewSubmissionResult> {
  try {
    const csrfResponse = await fetcher("/api/v1/auth/csrf", { cache: "no-store", credentials: "same-origin" });
    if (!csrfResponse.ok) return { ok: false, message: failureFor(csrfResponse.status) };
    const csrfToken = record(await csrfResponse.json())?.csrfToken;
    if (typeof csrfToken !== "string" || csrfToken.length === 0) return { ok: false, message: "We could not prepare your review. Please try again." };

    const response = await fetcher(`/api/v1/movies/${encodeURIComponent(movieId)}/reviews`, {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      method: "POST",
    });
    const body: unknown = await response.json().catch(() => undefined);
    return response.status === 201 && isSubmission(body)
      ? { ok: true, value: body }
      : { ok: false, message: failureFor(response.status) };
  } catch {
    return { ok: false, message: "We could not submit your review. Please try again." };
  }
}

export async function getOwnReviewForMovie(movieId: string, fetcher: Fetcher = fetch): Promise<Readonly<{ ok: true; value: OwnMovieReview | null }> | Readonly<{ ok: false; message: string }>> {
  try {
    const response = await fetcher("/api/v1/me/reviews?page=1&pageSize=100", { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401) return { ok: true, value: null };
    if (!response.ok) return { ok: false, message: "We could not load your review. Please try again." };
    const body: unknown = await response.json();
    if (!isReviewPage(body)) return { ok: false, message: "We could not load your review. Please try again." };
    return { ok: true, value: body.items.find((review) => review.movieId === movieId) ?? null };
  } catch {
    return { ok: false, message: "We could not load your review. Please try again." };
  }
}

export async function updateReview(reviewId: string, version: number, input: ReviewSubmissionInput, fetcher: Fetcher = fetch): Promise<ReviewUpdateResult> {
  try {
    const csrfResponse = await fetcher("/api/v1/auth/csrf", { cache: "no-store", credentials: "same-origin" });
    if (!csrfResponse.ok) return { ok: false, message: failureFor(csrfResponse.status) };
    const csrfToken = record(await csrfResponse.json())?.csrfToken;
    if (typeof csrfToken !== "string" || csrfToken.length === 0) return { ok: false, message: "We could not prepare your review. Please try again." };
    const response = await fetcher(`/api/v1/reviews/${encodeURIComponent(reviewId)}`, {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "If-Match": `"${version}"`, "X-CSRF-Token": csrfToken },
      method: "PATCH",
    });
    const body: unknown = await response.json().catch(() => undefined);
    return response.status === 200 && isSubmission(body) ? { ok: true, value: body } : { ok: false, message: response.status === 409 ? "This review changed. Reload the page before saving again." : "We could not save your review. Please try again." };
  } catch {
    return { ok: false, message: "We could not save your review. Please try again." };
  }
}
