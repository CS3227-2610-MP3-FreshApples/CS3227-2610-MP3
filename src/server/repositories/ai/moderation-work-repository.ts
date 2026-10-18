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

/**
 * K9 access to app.moderation_work (D-50). Every statement runs inside a Tx that already holds the Review
 * `FOR UPDATE` lock (D-58); none of them reads or locks a Review or Movie row. Rows of one Review are locked
 * in ascending ID order before they are updated (D-20, D-58). No statement changes `execution_count`,
 * `last_attempt_at`, `model_id` or `next_attempt_at` of an existing row.
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
  };
}
