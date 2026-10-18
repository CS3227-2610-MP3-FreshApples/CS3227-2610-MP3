import { beforeEach, describe, expect, it } from "vitest";

import {
  PROFANITY_POLICY_VERSION,
  REVIEW_SCREENING_PROMPT_VERSION,
  type ModerationWorkQueue,
} from "../../../src/server/services/ai/moderation";
import type { ContentRevision, ReviewId, Tx } from "../../../src/server/shared";

export type WorkStatus = "pending" | "running" | "completed" | "needs_manual_review" | "superseded" | "cancelled";

/** The ModerationWork columns K9 reads or writes, as stored by the implementation under test. */
export interface StoredWork {
  readonly contentRevision: number;
  readonly modelId: string | null;
  readonly promptVersion: string;
  readonly policyVersion: string;
  readonly status: WorkStatus;
  readonly executionCount: number;
  readonly nextAttemptAt: Date;
  readonly lastAttemptAt: Date | null;
  readonly updatedAt: Date;
}

export interface WorkSeed {
  readonly contentRevision: number;
  readonly status: WorkStatus;
  readonly modelId?: string | null;
  readonly promptVersion?: string;
  readonly policyVersion?: string;
  readonly executionCount?: number;
  readonly lastAttemptAt?: Date | null;
}

export interface ModerationWorkQueueHarness {
  readonly queue: ModerationWorkQueue;
  /** Stores a Review the queue can write work for. */
  seedReview(): Promise<ReviewId>;
  /** An id no stored Review has. */
  missingReviewId(): ReviewId;
  /** Stores a ModerationWork row with `updated_at` and `next_attempt_at` in the past. */
  seedWork(reviewId: ReviewId, seed: WorkSeed): Promise<void>;
  /** Runs `work` in a Tx that first locks the Review `FOR UPDATE` (D-58, Movie then Review) and commits. */
  inReviewLockedTx<T>(reviewId: ReviewId, work: (tx: Tx) => Promise<T>): Promise<T>;
  /** The Review's work, ordered by content revision, then prompt, then policy version. */
  storedWork(reviewId: ReviewId): Promise<readonly StoredWork[]>;
}

// Synthetic times and identifiers, well before any test run.
export const SEEDED_WORK_AT = new Date("2026-01-01T00:00:00.000Z");
const LAST_ATTEMPT_AT = new Date("2026-01-01T06:00:00.000Z");
const MODEL = "synthetic-model";
const OLD_PROMPT_VERSION = "review-screening-prompt-v0";

const OUTSTANDING: readonly WorkStatus[] = ["pending", "running", "needs_manual_review"];
const FINAL: readonly WorkStatus[] = ["completed", "superseded", "cancelled"];
const ALL_STATUSES: readonly WorkStatus[] = [...OUTSTANDING, ...FINAL];

const rev = (value: number) => value as ContentRevision;

/**
 * K9 ModerationWorkQueue contract suite (workflow/contracts.md §12, §22 AM-14, §23 AM-17; D-49, D-50, D-58).
 * Every call runs in a Tx that holds the Review lock, as D-58 requires. Rollback and racing clients need
 * PostgreSQL and are tested only there.
 */
export function describeModerationWorkQueueContract(
  label: string,
  setup: () => Promise<ModerationWorkQueueHarness>,
): void {
  describe(`ModerationWork queue (K9) contract — ${label}`, () => {
    let harness: ModerationWorkQueueHarness;

    beforeEach(async () => {
      harness = await setup();
    });

    const enqueue = (reviewId: ReviewId, contentRevision: number) =>
      harness.inReviewLockedTx(reviewId, (tx) => harness.queue.enqueue(tx, reviewId, rev(contentRevision)));
    const cancel = (reviewId: ReviewId) =>
      harness.inReviewLockedTx(reviewId, (tx) => harness.queue.cancelForDeletedReview(tx, reviewId));

    async function seedOutstandingAndFinal(reviewId: ReviewId, contentRevision: number): Promise<void> {
      for (const [index, status] of ALL_STATUSES.entries()) {
        await harness.seedWork(reviewId, {
          contentRevision,
          status,
          // Distinct prompt versions keep the six rows apart under the unique key.
          promptVersion: `review-screening-prompt-v${100 + index}`,
          modelId: status === "pending" ? null : MODEL,
          executionCount: 2,
          lastAttemptAt: LAST_ATTEMPT_AT,
        });
      }
    }

    describe("enqueue (D-50)", () => {
      it("inserts pending work with model_id NULL and the module's prompt and policy versions", async () => {
        const reviewId = await harness.seedReview();

        await enqueue(reviewId, 1);

        const rows = await harness.storedWork(reviewId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          contentRevision: 1,
          modelId: null,
          promptVersion: REVIEW_SCREENING_PROMPT_VERSION,
          policyVersion: PROFANITY_POLICY_VERSION,
          status: "pending",
          executionCount: 0,
          lastAttemptAt: null,
        });
        expect(rows[0]!.nextAttemptAt.getTime()).toBeGreaterThan(SEEDED_WORK_AT.getTime());
        expect(rows[0]!.updatedAt.getTime()).toBeGreaterThan(SEEDED_WORK_AT.getTime());
      });

      it("is idempotent: enqueueing the same revision twice leaves one unchanged row", async () => {
        const reviewId = await harness.seedReview();

        await enqueue(reviewId, 1);
        const first = await harness.storedWork(reviewId);
        await enqueue(reviewId, 1);

        expect(await harness.storedWork(reviewId)).toEqual(first);
      });

      it("inserts nothing when a row for the revision has a non-NULL model_id", async () => {
        const reviewId = await harness.seedReview();
        await harness.seedWork(reviewId, { contentRevision: 1, status: "pending", modelId: MODEL });
        const before = await harness.storedWork(reviewId);

        await enqueue(reviewId, 1);

        expect(await harness.storedWork(reviewId)).toEqual(before);
      });

      it.each(ALL_STATUSES)(
        "inserts nothing and leaves a same-revision %s row unchanged (never reactivates a final row)",
        async (status) => {
          const reviewId = await harness.seedReview();
          await harness.seedWork(reviewId, {
            contentRevision: 3,
            status,
            modelId: MODEL,
            executionCount: 2,
            lastAttemptAt: LAST_ATTEMPT_AT,
          });
          const before = await harness.storedWork(reviewId);

          await enqueue(reviewId, 3);

          expect(await harness.storedWork(reviewId)).toEqual(before);
        },
      );

      it("inserts current-version work beside a same-revision row recorded under another prompt version", async () => {
        const reviewId = await harness.seedReview();
        await harness.seedWork(reviewId, { contentRevision: 2, status: "pending", promptVersion: OLD_PROMPT_VERSION });
        const [old] = await harness.storedWork(reviewId);

        await enqueue(reviewId, 2);

        const rows = await harness.storedWork(reviewId);
        expect(rows).toHaveLength(2);
        expect(rows.find((row) => row.promptVersion === OLD_PROMPT_VERSION)).toEqual(old);
        expect(rows.find((row) => row.promptVersion === REVIEW_SCREENING_PROMPT_VERSION)).toMatchObject({
          contentRevision: 2,
          status: "pending",
          modelId: null,
        });
      });

      it("supersedes pending, running and needs_manual_review rows of lower revisions and leaves final rows", async () => {
        const reviewId = await harness.seedReview();
        await seedOutstandingAndFinal(reviewId, 1);
        await harness.seedWork(reviewId, { contentRevision: 2, status: "running", modelId: MODEL, executionCount: 1 });
        const before = await harness.storedWork(reviewId);

        await enqueue(reviewId, 3);

        const after = await harness.storedWork(reviewId);
        expect(after).toHaveLength(before.length + 1);
        for (const row of before) {
          const updated = after.find(
            (candidate) =>
              candidate.contentRevision === row.contentRevision && candidate.promptVersion === row.promptVersion,
          )!;
          if (OUTSTANDING.includes(row.status)) {
            expect(updated.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
            // Only status and updated_at change: execution_count, last_attempt_at and model_id are kept.
            expect(updated).toEqual({ ...row, status: "superseded", updatedAt: updated.updatedAt });
          } else {
            expect(updated).toEqual(row);
          }
        }
        expect(after.filter((row) => row.contentRevision === 3)).toMatchObject([{ status: "pending" }]);
      });

      it("does not supersede work of the same or a higher revision", async () => {
        const reviewId = await harness.seedReview();
        await harness.seedWork(reviewId, { contentRevision: 2, status: "pending", promptVersion: OLD_PROMPT_VERSION });
        await harness.seedWork(reviewId, { contentRevision: 4, status: "running", modelId: MODEL });
        const before = await harness.storedWork(reviewId);

        await enqueue(reviewId, 2);

        const after = await harness.storedWork(reviewId);
        for (const row of before) {
          expect(after).toContainEqual(row);
        }
      });

      it("changes only the given Review's work", async () => {
        const reviewId = await harness.seedReview();
        const otherId = await harness.seedReview();
        await harness.seedWork(otherId, { contentRevision: 1, status: "pending" });
        const other = await harness.storedWork(otherId);

        await enqueue(reviewId, 2);

        expect(await harness.storedWork(otherId)).toEqual(other);
      });

      it("throws for an unknown Review and stores no work", async () => {
        const missing = harness.missingReviewId();

        await expect(enqueue(missing, 1)).rejects.toThrow();
        expect(await harness.storedWork(missing)).toEqual([]);
      });
    });

    describe("cancelForDeletedReview (D-50)", () => {
      it("cancels pending, running and needs_manual_review rows and leaves final rows", async () => {
        const reviewId = await harness.seedReview();
        await seedOutstandingAndFinal(reviewId, 1);
        await harness.seedWork(reviewId, { contentRevision: 2, status: "pending" });
        const before = await harness.storedWork(reviewId);

        await cancel(reviewId);

        const after = await harness.storedWork(reviewId);
        expect(after).toHaveLength(before.length);
        before.forEach((row, index) => {
          const updated = after[index]!;
          if (OUTSTANDING.includes(row.status)) {
            expect(updated.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
            expect(updated).toEqual({ ...row, status: "cancelled", updatedAt: updated.updatedAt });
          } else {
            expect(updated).toEqual(row);
          }
        });
      });

      it("is a no-op when the Review has only final work", async () => {
        const reviewId = await harness.seedReview();
        for (const [index, status] of FINAL.entries()) {
          await harness.seedWork(reviewId, { contentRevision: index + 1, status, modelId: MODEL });
        }
        const before = await harness.storedWork(reviewId);

        await cancel(reviewId);

        expect(await harness.storedWork(reviewId)).toEqual(before);
      });

      it("is a no-op when the Review has no work", async () => {
        const reviewId = await harness.seedReview();

        await cancel(reviewId);

        expect(await harness.storedWork(reviewId)).toEqual([]);
      });

      it("changes only the given Review's work", async () => {
        const reviewId = await harness.seedReview();
        const otherId = await harness.seedReview();
        await harness.seedWork(reviewId, { contentRevision: 1, status: "pending" });
        await harness.seedWork(otherId, { contentRevision: 1, status: "pending" });
        const other = await harness.storedWork(otherId);

        await cancel(reviewId);

        expect(await harness.storedWork(otherId)).toEqual(other);
      });

      it("is not undone by a later enqueue of the same revision", async () => {
        const reviewId = await harness.seedReview();
        await enqueue(reviewId, 1);
        await cancel(reviewId);
        const cancelled = await harness.storedWork(reviewId);

        await enqueue(reviewId, 1);

        expect(cancelled).toMatchObject([{ status: "cancelled" }]);
        expect(await harness.storedWork(reviewId)).toEqual(cancelled);
      });
    });
  });
}
