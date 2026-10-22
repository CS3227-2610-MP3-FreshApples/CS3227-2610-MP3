import { describe, expect, it } from "vitest";

import { listOwnReviews, pageFromSearchParam, updateOwnReview } from "../../../src/app/app/reviews/_lib/review-client";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("My reviews client", () => {
  it("maps the page URL to the requested private review page", () => {
    expect(pageFromSearchParam("2")).toBe(2);
    expect(pageFromSearchParam("0")).toBe(1);
    expect(pageFromSearchParam("not-a-page")).toBe(1);
    expect(pageFromSearchParam(["3", "4"])).toBe(1);
  });

  it("requests the private page without caching and accepts an empty page", async () => {
    let request: RequestInfo | URL | undefined;
    let options: RequestInit | undefined;
    const result = await listOwnReviews(2, async (input, init) => {
      request = input;
      options = init;
      return response(200, { items: [], page: 2, pageSize: 20, total: 0 });
    });

    expect(result).toEqual({ ok: true, value: { items: [], page: 2, pageSize: 20, total: 0 } });
    expect(request).toBe("/api/v1/me/reviews?page=2&pageSize=20");
    expect(options).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  });

  it("retains the safe version token and sends it when editing an own review", async () => {
    const review = { id: "review-1", movieId: "movie-1", author: { id: "user-1", displayName: "Reviewer" }, rating: 8, body: "A thoughtful review.", createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z", moderationState: "cleared", version: 3 } as const;
    await expect(listOwnReviews(1, async () => response(200, { items: [review], page: 1, pageSize: 20, total: 1 }))).resolves.toMatchObject({ ok: true, value: { items: [review] } });

    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    await expect(updateOwnReview(review.id, review.version, { rating: 9, body: "An updated review." }, async (input, init) => {
      calls.push({ input, init });
      return calls.length === 1 ? response(200, { csrfToken: "csrf-token" }) : response(200, { ...review, rating: 9, body: "An updated review.", version: 4, message: "Review saved and is pending moderation.", moderationState: "pending" });
    })).resolves.toMatchObject({ ok: true, value: { version: 4, moderationState: "pending" } });
    expect(calls[1]).toMatchObject({ input: "/api/v1/reviews/review-1", init: expect.objectContaining({ method: "PATCH", body: JSON.stringify({ rating: 9, body: "An updated review." }) }) });
    expect(calls[1]?.init?.headers).toEqual({ "Content-Type": "application/json", "If-Match": "\"3\"", "X-CSRF-Token": "csrf-token" });
  });

  it("maps an expired session and malformed success body to safe messages", async () => {
    await expect(listOwnReviews(1, async () => response(401, { error: { code: "unauthenticated" } }))).resolves.toEqual({
      ok: false,
      message: "Your session has ended. Sign in again to continue.",
    });
    await expect(listOwnReviews(1, async () => response(200, { items: [{ body: "unexpected" }] }))).resolves.toEqual({
      ok: false,
      message: "We could not load your reviews. Please try again.",
    });
  });
});
