import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAdminReviewTransitions } from "../../../src/server/services/reviews";
import type { ReviewTransitionRow } from "../../../src/server/repositories/reviews";
import type { ContentRevision, MovieId, ReviewId, ReviewUpdateLock, RowVersion, Tx } from "../../../src/server/shared";

const TX = {} as Tx;
const REVIEW_ID = "00000000-0000-4000-8000-000000000001" as ReviewId;
const MOVIE_ID = "00000000-0000-4000-8000-000000000002" as MovieId;
const MOVIE = { movieId: MOVIE_ID, archived: false, reviewsRevision: 4 } as ReviewUpdateLock["movie"];

function review(overrides: Partial<ReviewUpdateLock> = {}): ReviewUpdateLock {
  return {
    reviewId: REVIEW_ID,
    movie: MOVIE,
    version: 3 as RowVersion,
    contentRevision: 2 as ContentRevision,
    moderationState: "pending",
    hidden: false,
    deleted: false,
    ...overrides,
  } as ReviewUpdateLock;
}

function updated(overrides: Partial<ReviewTransitionRow> = {}): ReviewTransitionRow {
  return {
    id: REVIEW_ID,
    version: 4 as RowVersion,
    content_revision: 2 as ContentRevision,
    moderation_state: "cleared",
    hidden_at: null,
    deleted_at: null,
    ...overrides,
  };
}

function transitions(update: (kind: string, review: ReviewUpdateLock) => Promise<ReviewTransitionRow | null>) {
  const calls: string[] = [];
  return {
    calls,
    value: createAdminReviewTransitions({
      reviews: {
        async approveAdmin(_tx, saved) {
          calls.push("approve");
          return update("approve", saved);
        },
        async hideAdmin(_tx, saved) {
          calls.push("hide");
          return update("hide", saved);
        },
        async restoreAdmin(_tx, saved) {
          calls.push("restore");
          return update("restore", saved);
        },
        async hideForAcceptedReport(_tx, saved) {
          calls.push("report-hide");
          return update("report-hide", saved);
        },
      },
      reviewsChangedMarker: {
        async markReviewsChanged(_tx, movie) {
          calls.push(`mark:${movie.movieId}`);
          return 5 as never;
        },
      },
    }),
  };
}

describe("K8 Admin review transitions", () => {
  it("approves a held review, preserves deletion/hidden state, and marks eligibility when it changes", async () => {
    const fixture = transitions(async () => updated({ deleted_at: new Date("2026-01-01T00:00:00Z"), hidden_at: new Date("2026-01-01T00:00:00Z") }));

    await expect(fixture.value.approveHeldReview(TX, review(), 3 as RowVersion)).resolves.toEqual({
      ok: true,
      value: {
        reviewId: REVIEW_ID,
        version: 4,
        moderationState: "cleared",
        hidden: true,
        deleted: true,
        eligibilityChanged: false,
      },
    });
    expect(fixture.calls).toEqual(["approve"]);
  });

  it("hides an eligible review and marks the Movie once", async () => {
    const fixture = transitions(async () => updated({ hidden_at: new Date("2026-01-01T00:00:00Z") }));

    await expect(fixture.value.hideReview(TX, review({ moderationState: "cleared" }), 3 as RowVersion)).resolves.toMatchObject({
      ok: true,
      value: { moderationState: "cleared", hidden: true, eligibilityChanged: true },
    });
    expect(fixture.calls).toEqual(["hide", `mark:${MOVIE_ID}`]);
  });

  it("restores only visibility and marks when a cleared review becomes eligible", async () => {
    const fixture = transitions(async () => updated({ hidden_at: null, moderation_state: "cleared" }));

    await expect(fixture.value.restoreHiddenReview(TX, review({ moderationState: "cleared", hidden: true }), 3 as RowVersion)).resolves.toMatchObject({
      ok: true,
      value: { moderationState: "cleared", hidden: false, eligibilityChanged: true },
    });
    expect(fixture.calls).toEqual(["restore", `mark:${MOVIE_ID}`]);
  });

  it("hides a cleared review for an accepted report and is idempotent when already hidden", async () => {
    const fixture = transitions(async () => updated({ hidden_at: new Date("2026-01-01T00:00:00Z") }));

    await expect(fixture.value.hideReviewForAcceptedReport(TX, review({ moderationState: "cleared" }))).resolves.toMatchObject({
      reviewId: REVIEW_ID,
      moderationState: "cleared",
      hidden: true,
      eligibilityChanged: true,
    });
    await expect(fixture.value.hideReviewForAcceptedReport(TX, review({ moderationState: "cleared", hidden: true }))).resolves.toMatchObject({
      version: 3,
      hidden: true,
      eligibilityChanged: false,
    });
    expect(fixture.calls).toEqual(["report-hide", `mark:${MOVIE_ID}`]);
  });

  it("rejects a stale If-Match before deciding a no-op", async () => {
    const fixture = transitions(async () => updated());

    await expect(fixture.value.hideReview(TX, review({ hidden: true }), 2 as RowVersion)).resolves.toEqual({
      ok: false,
      error: { kind: "stale_version" },
    });
    expect(fixture.calls).toEqual([]);
  });

  it.each([
    ["already cleared approval", "approveHeldReview", review({ moderationState: "cleared" })],
    ["already hidden hide", "hideReview", review({ hidden: true })],
    ["visible restore", "restoreHiddenReview", review()],
  ] as const)("returns an unchanged no-op for %s", async (_label, method, saved) => {
    const fixture = transitions(async () => updated());
    const result = await fixture.value[method](TX, saved, saved.version);

    expect(result).toEqual({
      ok: true,
      value: {
        reviewId: REVIEW_ID,
        version: 3,
        moderationState: saved.moderationState,
        hidden: saved.hidden,
        deleted: saved.deleted,
        eligibilityChanged: false,
      },
    });
    expect(fixture.calls).toEqual([]);
  });
});
