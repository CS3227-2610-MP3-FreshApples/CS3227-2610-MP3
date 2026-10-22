export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ReviewSubmissionInput = Readonly<{ rating: number; body: string }>;
export type ReviewSubmissionValue = Readonly<{ id: string; moderationState: "pending" | "flagged" | "cleared"; message: string }>;
export type ReviewSubmissionResult = Readonly<{ ok: true; value: ReviewSubmissionValue }> | Readonly<{ ok: false; message: string }>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isSubmission(value: unknown): value is ReviewSubmissionValue {
  const result = record(value);
  return result !== null
    && typeof result.id === "string"
    && (result.moderationState === "pending" || result.moderationState === "flagged" || result.moderationState === "cleared")
    && typeof result.message === "string";
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
