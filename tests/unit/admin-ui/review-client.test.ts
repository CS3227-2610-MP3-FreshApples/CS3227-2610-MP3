import { describe, expect, it } from "vitest";
import { adminReviewView } from "../../support/admin-review-view";
import {
  approveReview, hideReview, restoreReview, getReview, listReviews,
  isAdminReview, reviewQueueHref, validateReviewReason,
} from "../../../src/app/admin/_lib/review-client";
import type { Fetcher } from "../../../src/app/admin/_lib/admin-http";

describe("A-04 browser client", () => {
  it("keeps filters on pagination links and encodes values", () => {
    const href = reviewQueueHref(2, { movieId: "a&b", assessment: "flagged" });
    const url = new URL(href, "https://example.test");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("movieId")).toBe("a&b");
    expect(url.searchParams.get("assessment")).toBe("flagged");
  });
  it("reads only the guarded API with no-store", async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (input, init) => {
      calls.push(String(input));
      expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
      return Response.json(String(input).includes("?")
        ? { items: [adminReviewView], page: 2, pageSize: 20, total: 21 } : adminReviewView);
    };
    expect((await listReviews(2, { movieId: adminReviewView.movieId, assessment: "hidden" }, fetcher)).ok).toBe(true);
    expect((await getReview(adminReviewView.id, fetcher)).ok).toBe(true);
    expect(calls.every((path) => path.startsWith("/api/v1/admin/reviews"))).toBe(true);
  });
  it.each([approveReview, hideReview, restoreReview])("sends only the reason, CSRF token and captured If-Match", async (operation) => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const fetcher: Fetcher = async (input, init) => {
      calls.push({ path: String(input), init });
      return Response.json(String(input).endsWith("/csrf") ? { csrfToken: "synthetic-token" } : {
        reviewId: adminReviewView.id, version: 2, moderationState: "cleared", hidden: false, deleted: false, eligibilityChanged: true,
      });
    };
    expect((await operation(adminReviewView.id, 1, "  Human reviewed this.  ", fetcher)).ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.init).toMatchObject({ method: "POST", headers: { "If-Match": '"1"', "X-CSRF-Token": "synthetic-token" } });
    expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({ reason: "Human reviewed this." });
    expect(calls[1]!.path).toMatch(/\/(approve|hide|restore)$/);
  });
  it("rejects malformed assessment shapes instead of trusting API data", () => {
    expect(isAdminReview(adminReviewView)).toBe(true);
    for (const patch of [{ authorDisplayName: null }, { version: -1 }, { latestAssessment: {} }, { moderationState: "published" }]) {
      expect(isAdminReview({ ...adminReviewView, ...patch })).toBe(false);
    }
  });
  it("validates trimmed Unicode reasons", () => {
    expect(validateReviewReason(" 😀😀😀😀😀😀😀😀😀😀 ")).toBe("");
    expect(validateReviewReason("short")).not.toBe("");
    expect(validateReviewReason("x".repeat(1001))).not.toBe("");
  });
});
