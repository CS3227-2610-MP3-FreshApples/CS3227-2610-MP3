import "server-only";

import type { Sql } from "../../db";
import type { Tx } from "../../shared";

/** One validated automatic assessment (AI-02, D-101). */
export interface NewReviewModeration {
  readonly jobId: string;
  readonly reviewId: string;
  readonly contentRevision: number;
  readonly capturedReviewVersion: number;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly policyVersion: string;
  /** The validated output, already serialized as JSON. */
  readonly outputJson: string;
}

/**
 * Insert-only access to app.review_moderation, inside K10's publish Tx after the Review and ModerationWork locks
 * (D-58, D-101). The `job_id` foreign key takes a key-share lock on the AIJob, which never blocks K10 (D-73).
 */
export interface ReviewModerationRepository {
  insert(tx: Tx, row: NewReviewModeration): Promise<void>;
}

const INSERT = `
  INSERT INTO app.review_moderation
    (job_id, review_id, content_revision, captured_review_version, model_id, prompt_version, policy_version,
     output_json, generated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())`;

export function createReviewModerationRepository(deps: { sql: Sql }): ReviewModerationRepository {
  const { sql } = deps;
  return {
    async insert(tx, row) {
      await sql.query(tx, INSERT, [
        row.jobId,
        row.reviewId,
        row.contentRevision,
        row.capturedReviewVersion,
        row.modelId,
        row.promptVersion,
        row.policyVersion,
        row.outputJson,
      ]);
    },
  };
}
