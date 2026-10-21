import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFailClosedReviewTransitions } from "../../support/fakes/review-transitions";
import type { CapturedReviewVersion } from "../../../src/server/services/reviews";
import type { ContentRevision, ReviewId, ReviewUpdateLock, RowVersion, Tx } from "../../../src/server/shared";

const REVIEW_ID = "00000000-0000-4000-8000-000000000001" as ReviewId;
const TX = {} as Tx;
const REVIEW = {
  reviewId: REVIEW_ID,
  movie: {
    movieId: "00000000-0000-4000-8000-000000000002",
    archived: false,
    reviewsRevision: 1,
  },
  version: 2 as RowVersion,
  contentRevision: 1,
  moderationState: "pending",
  hidden: false,
  deleted: false,
} as ReviewUpdateLock;
const CAPTURED: CapturedReviewVersion = { contentRevision: 1 as ContentRevision, version: 2 as RowVersion };

describe("K8 fail-closed fake", () => {
  it("does not expose an unseeded review lock or screening source", async () => {
    const fake = createFailClosedReviewTransitions();

    await expect(fake.locks.lockReviewForTransition(TX, REVIEW_ID)).resolves.toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    await expect(fake.reads.readReviewForScreening(TX, REVIEW_ID)).resolves.toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });

  it("rejects every unscripted automatic and Admin transition", async () => {
    const fake = createFailClosedReviewTransitions();

    await expect(fake.transitions.applyAutomaticClearance(TX, REVIEW, CAPTURED)).resolves.toEqual({
      ok: false,
      error: { kind: "stale" },
    });
    await expect(fake.transitions.applyAutomaticFlag(TX, REVIEW, CAPTURED)).resolves.toEqual({
      ok: false,
      error: { kind: "stale" },
    });
    await expect(fake.transitions.approveHeldReview(TX, REVIEW, REVIEW.version)).resolves.toEqual({
      ok: false,
      error: { kind: "stale_version" },
    });
    await expect(fake.transitions.hideReview(TX, REVIEW, REVIEW.version)).resolves.toEqual({
      ok: false,
      error: { kind: "stale_version" },
    });
    await expect(fake.transitions.restoreHiddenReview(TX, REVIEW, REVIEW.version)).resolves.toEqual({
      ok: false,
      error: { kind: "stale_version" },
    });
  });

  it("does not silently provide an accepted-report hide transition", async () => {
    const fake = createFailClosedReviewTransitions();

    await expect(fake.transitions.hideReviewForAcceptedReport(TX, REVIEW)).rejects.toThrow("not scripted");
  });
});
