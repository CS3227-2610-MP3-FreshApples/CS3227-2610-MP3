import type {
  ReviewLocks,
  ReviewModerationReads,
  ReviewTransitions,
} from "../../../src/server/services/reviews";

export interface FailClosedReviewTransitions {
  readonly locks: ReviewLocks;
  readonly reads: ReviewModerationReads;
  readonly transitions: ReviewTransitions;
}

export function createFailClosedReviewTransitions(): FailClosedReviewTransitions {
  return {
    locks: {
      async lockReviewForTransition() {
        return { ok: false, error: { kind: "not_found" } };
      },
      async lockReviewsOfMovie() {
        throw new Error("not scripted");
      },
    },
    reads: {
      async readReviewForScreening() {
        return { ok: false, error: { kind: "not_found" } };
      },
    },
    transitions: {
      async applyAutomaticClearance() {
        return { ok: false, error: { kind: "stale" } };
      },
      async applyAutomaticFlag() {
        return { ok: false, error: { kind: "stale" } };
      },
      async approveHeldReview() {
        return { ok: false, error: { kind: "stale_version" } };
      },
      async hideReview() {
        return { ok: false, error: { kind: "stale_version" } };
      },
      async restoreHiddenReview() {
        return { ok: false, error: { kind: "stale_version" } };
      },
      async hideReviewForAcceptedReport() {
        throw new Error("not scripted");
      },
    },
  };
}
