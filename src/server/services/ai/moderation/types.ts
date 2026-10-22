import "server-only";

import type { ContentRevision, RequestId, ReviewId, Tx } from "../../../shared";

/**
 * K9 ModerationWork writes (workflow/contracts.md §12, §22 AM-14, §23 AM-17; D-50, D-58).
 *
 * **Locking precondition (D-58):** the caller must already hold the Review `FOR UPDATE` lock in `tx`, taken in
 * the D-20 order (Movie, then Review). Neither function locks the Movie or the Review itself. The database key
 * includes `model_id`, so it cannot enforce idempotency on its own; the Review lock is what makes the
 * check-then-insert in `enqueue` safe.
 *
 * Both functions set `updated_at` on the rows they change, and never change `execution_count`,
 * `last_attempt_at` or any Review row. Neither calls the provider.
 */
export interface ModerationWorkQueue {
  /**
   * In the review-write Tx. Inserts `pending` work for (review, revision, current prompt, current policy) with
   * `model_id` NULL, `execution_count` 0, `next_attempt_at` now() and `last_attempt_at` NULL, unless a row
   * with that review, revision, prompt and policy exists in any status and with any `model_id`. In the same
   * call, `pending`, `running` and `needs_manual_review` rows of lower revisions become `superseded`;
   * same-revision rows are left alone. It never reactivates a final row. Throws for an unknown Review (foreign
   * key), so the caller's Tx rolls back.
   */
  enqueue(tx: Tx, reviewId: ReviewId, contentRevision: ContentRevision): Promise<void>;
  /**
   * In the author-deletion Tx. Sets `pending`, `running` and `needs_manual_review` rows of the Review to
   * `cancelled`; a no-op when there are none. `completed`, `superseded` and `cancelled` rows are unchanged.
   */
  cancelForDeletedReview(tx: Tx, reviewId: ReviewId): Promise<void>;
}

export type ScreeningAttempt = "cleared" | "flagged" | "deferred" | "manual_review" | "not_current";

export interface ModerationDispatcher {
  /** After commit, no Tx open. Bounded by AI_EXECUTION_DEADLINE_MS. Never throws; any fault → "deferred". */
  attemptAfterCommit(reviewId: ReviewId, contentRevision: ContentRevision): Promise<ScreeningAttempt>;
}

/** B-internal, not part of K9 (contracts §29, AM-27): the review-moderation sweep's attempt (D-101). */
export interface ModerationRecovery {
  /**
   * Same rules as `attemptAfterCommit`, with trigger `scheduler` and no requester (D-64). Call it with no Tx open.
   * Never throws; any fault → "deferred".
   */
  attemptFromSweep(reviewId: ReviewId, contentRevision: ContentRevision, requestId: RequestId): Promise<ScreeningAttempt>;
}
