import {
  PROFANITY_POLICY_VERSION,
  REVIEW_SCREENING_PROMPT_VERSION,
  type ModerationDispatcher,
  type ModerationWorkQueue,
} from "../../../src/server/services/ai/moderation";
import type { ContentRevision, ReviewId } from "../../../src/server/shared";
import { SEEDED_WORK_AT, type StoredWork, type WorkSeed } from "../contracts/moderation-work-queue.contract";

export interface EnqueueCall {
  readonly reviewId: ReviewId;
  readonly contentRevision: ContentRevision;
}

export interface FakeModerationWorkQueue {
  readonly queue: ModerationWorkQueue;
  /** Stores a Review the queue can write work for. Unseeded Reviews make `enqueue` throw. */
  seedReview(reviewId: ReviewId): void;
  /** Stores a work row for a seeded Review, with `updatedAt` and `nextAttemptAt` in the past. */
  seedWork(reviewId: ReviewId, seed: WorkSeed): void;
  /** The Review's work, ordered by content revision, then prompt, then policy version. */
  storedWork(reviewId: ReviewId): readonly StoredWork[];
  /** Every `enqueue` call, in call order, including calls that threw. */
  readonly enqueueCalls: readonly EnqueueCall[];
  /** Every `cancelForDeletedReview` call, in call order. */
  readonly cancelCalls: readonly ReviewId[];
}

const OUTSTANDING = new Set(["pending", "running", "needs_manual_review"]);

function byKey(a: StoredWork, b: StoredWork): number {
  return (
    a.contentRevision - b.contentRevision ||
    (a.promptVersion < b.promptVersion ? -1 : a.promptVersion > b.promptVersion ? 1 : 0) ||
    (a.policyVersion < b.policyVersion ? -1 : a.policyVersion > b.policyVersion ? 1 : 0)
  );
}

/**
 * K9 queue fake (workflow/contracts.md §1 rule 6, §12; D-50). It records calls and writes the same columns as
 * the real queue. Fails closed: `enqueue` throws for an unseeded Review, as the foreign key does. It has no
 * transactions or row locks: rollback and racing clients need PostgreSQL (D-10). Times come from `now`, which
 * defaults to the system clock.
 */
export function createFakeModerationWorkQueue(deps: { now?: () => Date } = {}): FakeModerationWorkQueue {
  const now = deps.now ?? (() => new Date());
  const work = new Map<ReviewId, StoredWork[]>();
  const enqueueCalls: EnqueueCall[] = [];
  const cancelCalls: ReviewId[] = [];

  function rowsOf(reviewId: ReviewId): StoredWork[] {
    const rows = work.get(reviewId);
    if (rows === undefined) {
      throw new Error("review not seeded");
    }
    return rows;
  }

  function moveOutstanding(reviewId: ReviewId, status: "superseded" | "cancelled", below: number): void {
    const at = now();
    const rows = work.get(reviewId) ?? [];
    work.set(
      reviewId,
      rows.map((row) =>
        OUTSTANDING.has(row.status) && row.contentRevision < below ? { ...row, status, updatedAt: at } : row,
      ),
    );
  }

  return {
    enqueueCalls,
    cancelCalls,
    seedReview(reviewId) {
      work.set(reviewId, work.get(reviewId) ?? []);
    },
    seedWork(reviewId, seed) {
      rowsOf(reviewId).push({
        contentRevision: seed.contentRevision,
        modelId: seed.modelId ?? null,
        promptVersion: seed.promptVersion ?? REVIEW_SCREENING_PROMPT_VERSION,
        policyVersion: seed.policyVersion ?? PROFANITY_POLICY_VERSION,
        status: seed.status,
        executionCount: seed.executionCount ?? 0,
        nextAttemptAt: SEEDED_WORK_AT,
        lastAttemptAt: seed.lastAttemptAt ?? null,
        updatedAt: SEEDED_WORK_AT,
      });
    },
    storedWork(reviewId) {
      return [...(work.get(reviewId) ?? [])].sort(byKey);
    },
    queue: {
      async enqueue(_tx, reviewId, contentRevision) {
        enqueueCalls.push({ reviewId, contentRevision });
        if (!work.has(reviewId)) {
          throw new Error("unknown review");
        }
        moveOutstanding(reviewId, "superseded", contentRevision);
        const rows = rowsOf(reviewId);
        const recorded = rows.some(
          (row) =>
            row.contentRevision === contentRevision &&
            row.promptVersion === REVIEW_SCREENING_PROMPT_VERSION &&
            row.policyVersion === PROFANITY_POLICY_VERSION,
        );
        if (!recorded) {
          const at = now();
          rows.push({
            contentRevision,
            modelId: null,
            promptVersion: REVIEW_SCREENING_PROMPT_VERSION,
            policyVersion: PROFANITY_POLICY_VERSION,
            status: "pending",
            executionCount: 0,
            nextAttemptAt: at,
            lastAttemptAt: null,
            updatedAt: at,
          });
        }
      },
      async cancelForDeletedReview(_tx, reviewId) {
        cancelCalls.push(reviewId);
        moveOutstanding(reviewId, "cancelled", Number.POSITIVE_INFINITY);
      },
    },
  };
}

export interface AttemptCall {
  readonly reviewId: ReviewId;
  readonly contentRevision: ContentRevision;
}

export interface FakeModerationDispatcher extends ModerationDispatcher {
  /** Every `attemptAfterCommit` call, in call order. */
  readonly attemptCalls: readonly AttemptCall[];
}

/**
 * K9 dispatcher fake (contracts §12). Records calls and always returns `deferred`, so the Review stays pending
 * (§1 rule 6). Writes nothing.
 */
export function createFakeModerationDispatcher(): FakeModerationDispatcher {
  const attemptCalls: AttemptCall[] = [];
  return {
    attemptCalls,
    async attemptAfterCommit(reviewId, contentRevision) {
      attemptCalls.push({ reviewId, contentRevision });
      return "deferred";
    },
  };
}
