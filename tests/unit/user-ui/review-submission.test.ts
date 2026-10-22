import { describe, expect, it } from "vitest";

import { ReviewSubmissionForm } from "../../../src/app/(public)/movies/[id]/_components/review-submission-form";
import { submitReview } from "../../../src/app/(public)/movies/[id]/_lib/review-submit-client";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("review submission client", () => {
  it("renders an explicit loading state while checking the visitor session", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const rendered = renderToStaticMarkup(createElement(ReviewSubmissionForm, { movieId: "movie-1" }));

    expect(rendered).toContain('aria-label="Submit a review"');
    expect(rendered).toContain("Checking your sign-in…");
  });

  it("gets CSRF, posts the movie review, and returns the moderation message", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const result = await submitReview("movie-1", { rating: 8, body: "A thoughtful review." }, async (input, init) => {
      requests.push({ input, init });
      return requests.length === 1
        ? response(200, { csrfToken: "csrf-token" })
        : response(201, { id: "review-1", moderationState: "pending", message: "Review saved and is pending moderation." });
    });

    expect(result).toEqual({ ok: true, value: { id: "review-1", moderationState: "pending", message: "Review saved and is pending moderation." } });
    expect(requests[1]).toMatchObject({
      input: "/api/v1/movies/movie-1/reviews",
      init: expect.objectContaining({
        body: JSON.stringify({ rating: 8, body: "A thoughtful review." }),
        credentials: "same-origin",
        method: "POST",
      }),
    });
    expect(requests[1]?.init?.headers).toEqual({ "Content-Type": "application/json", "X-CSRF-Token": "csrf-token" });
  });

  it("maps validation and unauthenticated failures to safe messages", async () => {
    await expect(submitReview("movie-1", { rating: 8, body: "A thoughtful review." }, async () => response(401, {}))).resolves.toEqual({
      ok: false,
      message: "Sign in to submit a review.",
    });
    await expect(submitReview("movie-1", { rating: 8, body: "A thoughtful review." }, async () => response(200, {}))).resolves.toEqual({
      ok: false,
      message: "We could not prepare your review. Please try again.",
    });
  });
});
