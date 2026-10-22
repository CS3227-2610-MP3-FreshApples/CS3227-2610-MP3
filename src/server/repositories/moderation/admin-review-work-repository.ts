import "server-only";

import type { Sql } from "../../db";
import { createModerationWorkRepository } from "../ai";
import type { ModerationWorkKey } from "../ai/moderation-work-repository";
import type { ReviewId, Tx } from "../../shared";

/** A-04 writes only Moderation-owned work. The caller already holds K8's Review lock (D-58). */
export interface AdminReviewWorkRepository {
  supersedeOutstanding(tx: Tx, reviewId: ReviewId): Promise<void>;
  cancelOutstanding(tx: Tx, reviewId: ReviewId): Promise<void>;
  reactivate(tx: Tx, key: ModerationWorkKey): Promise<void>;
}

export function createAdminReviewWorkRepository({ sql }: { readonly sql: Sql }): AdminReviewWorkRepository {
  const queue = createModerationWorkRepository({ sql });
  return {
    async supersedeOutstanding(tx, reviewId) {
      await sql.query(tx, `
        WITH target AS (
          SELECT id FROM app.moderation_work
          WHERE review_id = $1 AND status IN ('pending', 'running', 'needs_manual_review')
          ORDER BY id FOR UPDATE
        )
        UPDATE app.moderation_work AS work SET status = 'superseded', updated_at = now()
        FROM target WHERE work.id = target.id`, [reviewId]);
    },
    cancelOutstanding: queue.cancelOutstanding,
    async reactivate(tx, key) {
      // Unlike enqueue, D-55 may leave cancelled, but only for this exact revision and versions.
      // Other statuses and revisions are untouched; attempt history and model remain unchanged.
      await sql.query(tx, `
        WITH target AS (
          SELECT id FROM app.moderation_work
          WHERE review_id = $1 AND content_revision = $2 AND prompt_version = $3 AND policy_version = $4
            AND status = 'cancelled'
          ORDER BY id FOR UPDATE
        )
        UPDATE app.moderation_work AS work
        SET status = 'pending', next_attempt_at = now(), updated_at = now()
        FROM target WHERE work.id = target.id`, [key.reviewId, key.contentRevision, key.promptVersion, key.policyVersion]);
      await queue.insertPendingUnlessRecorded(tx, key);
    },
  };
}
