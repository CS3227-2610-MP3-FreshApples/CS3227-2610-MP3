import "server-only";

import type { Sql } from "../../db";
import type { Tx } from "../../shared";

/** The ModerationWork identity `enqueue` checks (D-50). `model_id` is not part of it. */
export interface ModerationWorkKey {
  readonly reviewId: string;
  readonly contentRevision: number;
  readonly promptVersion: string;
  readonly policyVersion: string;
}

/** One ModerationWork row of the locked revision, as the dispatcher needs it (D-101). */
export interface ModerationWorkRow {
  readonly id: string;
  readonly promptVersion: string;
  readonly policyVersion: string;
  readonly status: "pending" | "running" | "completed" | "needs_manual_review" | "superseded" | "cancelled";
  readonly executionCount: number;
  /** `running` with `next_attempt_at` at or before now: the claim of a crashed execution (D-77, D-101). */
  readonly claimExpired: boolean;
}

/**
 * K9 access to app.moderation_work (D-50, D-101). Every statement runs inside a Tx that already holds the Review
 * `FOR UPDATE` lock (D-58); none of them reads or locks a Review or Movie row. Rows of one Review are locked
 * in ascending ID order before they are updated (D-20, D-58). The queue statements (`insertPendingUnlessRecorded`,
 * `supersedeBelowRevision`, `cancelOutstanding`) never change `execution_count`, `last_attempt_at`, `model_id` or
 * `next_attempt_at` of an existing row; the dispatcher statements after them do, as D-101 describes.
 */
export interface ModerationWorkRepository {
  /**
   * Inserts `pending` work with `model_id` NULL, `execution_count` 0, `next_attempt_at` now() and
   * `last_attempt_at` NULL, unless a row with the same key exists in any status and with any `model_id`.
   * Throws when the Review does not exist (foreign key).
   */
  insertPendingUnlessRecorded(tx: Tx, key: ModerationWorkKey): Promise<void>;
  /** Sets `superseded` on pending, running and needs_manual_review rows of the Review below `contentRevision`. */
  supersedeBelowRevision(tx: Tx, reviewId: string, contentRevision: number): Promise<void>;
  /** Sets `cancelled` on pending, running and needs_manual_review rows of the Review. */
  cancelOutstanding(tx: Tx, reviewId: string): Promise<void>;

  // Dispatcher statements (D-101).

  /** Locks every row of the Review's content revision `FOR UPDATE`, in ascending ID order. */
  lockRevision(tx: Tx, reviewId: string, contentRevision: number): Promise<readonly ModerationWorkRow[]>;
  /** Sets `superseded` on the given rows that are pending, running or needs_manual_review. */
  supersede(tx: Tx, workIds: readonly string[]): Promise<void>;
  /** Recovery (D-77): counts an expired claim as one failed execution; returns the new `execution_count`. */
  recordAbandonedExecution(tx: Tx, workId: string): Promise<number>;
  /** Stops automatic retries: `needs_manual_review`, other columns unchanged. */
  markNeedsManualReview(tx: Tx, workId: string): Promise<void>;
  /** `running` until now() + `claimSeconds`; sets `model_id` only when it is NULL (D-50). */
  claim(tx: Tx, workId: string, modelId: string, claimSeconds: number): Promise<void>;
  /** A running claim back to `pending` at now() + `delaySeconds`, with no execution consumed. */
  releaseClaim(tx: Tx, workId: string, delaySeconds: number): Promise<void>;
  /** A running claim: one failed execution, then `pending` at now() + `backoffSeconds`. */
  recordFailedExecution(tx: Tx, workId: string, backoffSeconds: number): Promise<void>;
  /** A running claim: one failed execution, then `needs_manual_review`. */
  recordFailedExecutionForManualReview(tx: Tx, workId: string): Promise<void>;
  /** A running claim whose result was stale: `pending` now, attempted now, no execution counted. */
  recordStaleAttempt(tx: Tx, workId: string): Promise<void>;
  /** A running claim whose result was published: `completed`, one execution counted. */
  complete(tx: Tx, workId: string): Promise<void>;
}

// Under the Review lock nothing else writes this Review's work, so the NOT EXISTS check cannot race (D-58).
// The unique key includes model_id (NULLS NOT DISTINCT), so it alone would not stop a second row (D-50).
const INSERT_PENDING_UNLESS_RECORDED = `
  INSERT INTO app.moderation_work
    (review_id, content_revision, model_id, prompt_version, policy_version, status, execution_count,
     next_attempt_at, last_attempt_at, created_at, updated_at)
  SELECT $1, $2, NULL, $3, $4, 'pending', 0, now(), NULL, now(), now()
  WHERE NOT EXISTS (
    SELECT 1 FROM app.moderation_work
    WHERE review_id = $1 AND content_revision = $2 AND prompt_version = $3 AND policy_version = $4
  )`;

const SUPERSEDE_BELOW_REVISION = `
  WITH target AS (
    SELECT id FROM app.moderation_work
    WHERE review_id = $1 AND content_revision < $2 AND status IN ('pending', 'running', 'needs_manual_review')
    ORDER BY id
    FOR UPDATE
  )
  UPDATE app.moderation_work AS work
  SET status = 'superseded', updated_at = now()
  FROM target
  WHERE work.id = target.id`;

const CANCEL_OUTSTANDING = `
  WITH target AS (
    SELECT id FROM app.moderation_work
    WHERE review_id = $1 AND status IN ('pending', 'running', 'needs_manual_review')
    ORDER BY id
    FOR UPDATE
  )
  UPDATE app.moderation_work AS work
  SET status = 'cancelled', updated_at = now()
  FROM target
  WHERE work.id = target.id`;

const LOCK_REVISION = `
  SELECT id, prompt_version, policy_version, status, execution_count,
         (status = 'running' AND next_attempt_at <= now()) AS claim_expired
  FROM app.moderation_work
  WHERE review_id = $1 AND content_revision = $2
  ORDER BY id
  FOR UPDATE`;

const SUPERSEDE = `
  UPDATE app.moderation_work
  SET status = 'superseded', updated_at = now()
  WHERE id = ANY($1::uuid[]) AND status IN ('pending', 'running', 'needs_manual_review')`;

const RECORD_ABANDONED_EXECUTION = `
  UPDATE app.moderation_work
  SET execution_count = execution_count + 1, last_attempt_at = now(), updated_at = now()
  WHERE id = $1 AND status = 'running'
  RETURNING execution_count`;

const MARK_NEEDS_MANUAL_REVIEW = `
  UPDATE app.moderation_work
  SET status = 'needs_manual_review', updated_at = now()
  WHERE id = $1 AND status IN ('pending', 'running')`;

const CLAIM = `
  UPDATE app.moderation_work
  SET status = 'running', model_id = coalesce(model_id, $2),
      next_attempt_at = now() + make_interval(secs => $3), updated_at = now()
  WHERE id = $1 AND status IN ('pending', 'running')`;

// The settlement statements change only a claim that is still running; a row that left `running` is untouched.
const RELEASE_CLAIM = `
  UPDATE app.moderation_work
  SET status = 'pending', next_attempt_at = now() + make_interval(secs => $2), updated_at = now()
  WHERE id = $1 AND status = 'running'`;

const RECORD_FAILED_EXECUTION = `
  UPDATE app.moderation_work
  SET status = 'pending', execution_count = execution_count + 1, last_attempt_at = now(),
      next_attempt_at = now() + make_interval(secs => $2), updated_at = now()
  WHERE id = $1 AND status = 'running'`;

const RECORD_FAILED_EXECUTION_FOR_MANUAL_REVIEW = `
  UPDATE app.moderation_work
  SET status = 'needs_manual_review', execution_count = execution_count + 1, last_attempt_at = now(),
      updated_at = now()
  WHERE id = $1 AND status = 'running'`;

const RECORD_STALE_ATTEMPT = `
  UPDATE app.moderation_work
  SET status = 'pending', last_attempt_at = now(), next_attempt_at = now(), updated_at = now()
  WHERE id = $1 AND status = 'running'`;

const COMPLETE = `
  UPDATE app.moderation_work
  SET status = 'completed', execution_count = execution_count + 1, last_attempt_at = now(), updated_at = now()
  WHERE id = $1 AND status = 'running'`;

interface WorkRowRecord {
  readonly id: string;
  readonly prompt_version: string;
  readonly policy_version: string;
  readonly status: ModerationWorkRow["status"];
  readonly execution_count: number;
  readonly claim_expired: boolean;
}

export function createModerationWorkRepository(deps: { sql: Sql }): ModerationWorkRepository {
  const { sql } = deps;
  return {
    async insertPendingUnlessRecorded(tx, key) {
      await sql.query(tx, INSERT_PENDING_UNLESS_RECORDED, [
        key.reviewId,
        key.contentRevision,
        key.promptVersion,
        key.policyVersion,
      ]);
    },
    async supersedeBelowRevision(tx, reviewId, contentRevision) {
      await sql.query(tx, SUPERSEDE_BELOW_REVISION, [reviewId, contentRevision]);
    },
    async cancelOutstanding(tx, reviewId) {
      await sql.query(tx, CANCEL_OUTSTANDING, [reviewId]);
    },
    async lockRevision(tx, reviewId, contentRevision) {
      const rows = await sql.query<WorkRowRecord>(tx, LOCK_REVISION, [reviewId, contentRevision]);
      return rows.map((row) => ({
        id: row.id,
        promptVersion: row.prompt_version,
        policyVersion: row.policy_version,
        status: row.status,
        executionCount: row.execution_count,
        claimExpired: row.claim_expired,
      }));
    },
    async supersede(tx, workIds) {
      if (workIds.length > 0) {
        await sql.query(tx, SUPERSEDE, [[...workIds]]);
      }
    },
    async recordAbandonedExecution(tx, workId) {
      const rows = await sql.query<{ execution_count: number }>(tx, RECORD_ABANDONED_EXECUTION, [workId]);
      const count = rows[0]?.execution_count;
      if (count === undefined) {
        throw new Error("abandoned moderation work is not running");
      }
      return count;
    },
    async markNeedsManualReview(tx, workId) {
      await sql.query(tx, MARK_NEEDS_MANUAL_REVIEW, [workId]);
    },
    async claim(tx, workId, modelId, claimSeconds) {
      await sql.query(tx, CLAIM, [workId, modelId, claimSeconds]);
    },
    async releaseClaim(tx, workId, delaySeconds) {
      await sql.query(tx, RELEASE_CLAIM, [workId, delaySeconds]);
    },
    async recordFailedExecution(tx, workId, backoffSeconds) {
      await sql.query(tx, RECORD_FAILED_EXECUTION, [workId, backoffSeconds]);
    },
    async recordFailedExecutionForManualReview(tx, workId) {
      await sql.query(tx, RECORD_FAILED_EXECUTION_FOR_MANUAL_REVIEW, [workId]);
    },
    async recordStaleAttempt(tx, workId) {
      await sql.query(tx, RECORD_STALE_ATTEMPT, [workId]);
    },
    async complete(tx, workId) {
      await sql.query(tx, COMPLETE, [workId]);
    },
  };
}
