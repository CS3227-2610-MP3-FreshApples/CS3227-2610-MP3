import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAutomaticReviewTransitions } from "../../../src/server/services/reviews";
import type { ReviewTransitionRow } from "../../../src/server/repositories/reviews";
import type { CapturedReviewVersion } from "../../../src/server/services/reviews";
import type { ContentRevision, MovieId, ReviewId, ReviewUpdateLock, RowVersion, Tx } from "../../../src/server/shared";

const TX = {} as Tx;
const REVIEW_ID = "00000000-0000-4000-8000-000000000001" as ReviewId;
const MOVIE_ID = "00000000-0000-4000-8000-000000000002" as MovieId;
const REVIEW = {
  reviewId: REVIEW_ID,
  movie: { movieId: MOVIE_ID, archived: false, reviewsRevision: 4 },
  version: 3 as RowVersion,
  contentRevision: 2 as ContentRevision,
  moderationState: "pending",
  hidden: false,
  deleted: false,
} as ReviewUpdateLock;
const CAPTURED: CapturedReviewVersion = { contentRevision: 2 as ContentRevision, version: 3 as RowVersion };

function updated(state: ReviewTransitionRow["moderation_state"]): ReviewTransitionRow {
  return {
    id: REVIEW_ID,
    version: 4 as RowVersion,
    content_revision: 2 as ContentRevision,
    moderation_state: state,
    hidden_at: null,
    deleted_at: null,
  };
}

describe("K8 automatic transitions", () => {
  it("clears the captured pending version and marks Movie eligibility changed", async () => {
    const calls: string[] = [];
    const transitions = createAutomaticReviewTransitions({
      reviews: {
        async applyAutomatic(_tx, _review, state) {
          calls.push(`update:${state}`);
          return updated(state);
        },
      },
      reviewsChangedMarker: {
        async markReviewsChanged(_tx, movie) {
          calls.push(`mark:${movie.movieId}`);
          return 5 as never;
        },
      },
    });

    await expect(transitions.applyAutomaticClearance(TX, REVIEW, CAPTURED)).resolves.toEqual({
      ok: true,
      value: {
        reviewId: REVIEW_ID,
        version: 4,
        moderationState: "cleared",
        hidden: false,
        deleted: false,
        eligibilityChanged: true,
      },
    });
    expect(calls).toEqual(["update:cleared", `mark:${MOVIE_ID}`]);
  });

  it("flags the captured pending version without changing Movie eligibility", async () => {
    const calls: string[] = [];
    const transitions = createAutomaticReviewTransitions({
      reviews: {
        async applyAutomatic(_tx, _review, state) {
          calls.push(`update:${state}`);
          return updated(state);
        },
      },
      reviewsChangedMarker: {
        async markReviewsChanged() {
          calls.push("mark");
          return 5 as never;
        },
      },
    });

    await expect(transitions.applyAutomaticFlag(TX, REVIEW, CAPTURED)).resolves.toMatchObject({
      ok: true,
      value: { reviewId: REVIEW_ID, moderationState: "flagged", eligibilityChanged: false },
    });
    expect(calls).toEqual(["update:flagged"]);
  });

  it.each([
    ["archived Movie", { review: { ...REVIEW, movie: { ...REVIEW.movie, archived: true } }, captured: CAPTURED, expected: { kind: "movie_archived" } }],
    ["stale content", { review: REVIEW, captured: { ...CAPTURED, contentRevision: 1 as ContentRevision }, expected: { kind: "stale" } }],
    ["stale row", { review: REVIEW, captured: { ...CAPTURED, version: 1 as RowVersion }, expected: { kind: "stale" } }],
    ["non-pending state", { review: { ...REVIEW, moderationState: "flagged" }, captured: CAPTURED, expected: { kind: "stale" } }],
    ["hidden review", { review: { ...REVIEW, hidden: true }, captured: CAPTURED, expected: { kind: "stale" } }],
    ["deleted review", { review: { ...REVIEW, deleted: true }, captured: CAPTURED, expected: { kind: "stale" } }],
  ] as const)("rejects %s without a write or marker", async (_label, input) => {
    let writes = 0;
    let marks = 0;
    const transitions = createAutomaticReviewTransitions({
      reviews: { async applyAutomatic() { writes += 1; return updated("cleared"); } },
      reviewsChangedMarker: { async markReviewsChanged() { marks += 1; return 5 as never; } },
    });

    await expect(transitions.applyAutomaticClearance(TX, input.review, input.captured)).resolves.toEqual({ ok: false, error: input.expected });
    expect({ writes, marks }).toEqual({ writes: 0, marks: 0 });
  });
});
