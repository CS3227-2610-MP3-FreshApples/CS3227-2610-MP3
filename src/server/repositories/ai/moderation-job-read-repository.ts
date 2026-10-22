import "server-only";

import type { Sql } from "../../db";
import type { AiJobId, ReviewId, Tx } from "../../shared";

/** The D-102 fields of one review-moderation AIJob. Holds no input, prompt, model, requester or provider text. */
export interface ModerationJobRecord {
  readonly id: AiJobId;
  readonly reviewId: ReviewId;
  readonly status: "running" | "succeeded" | "failed" | "stale";
  /** Seconds until the lease ends, rounded up and at least 1, for a running job; otherwise null. */
  readonly retryAfterSeconds: number | null;
  /** The validated assessment of a succeeded job; otherwise null. */
  readonly assessment: string | null;
  /** The D-64 `error_code`, a fixed vocabulary. */
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Read-only access for the Admin job status read (D-102). It never writes and never dispatches work. */
export interface ModerationJobReadRepository {
  /** `null` for an unknown ID and for any job that is not `review_moderation`. */
  read(tx: Tx, jobId: AiJobId): Promise<ModerationJobRecord | null>;
}

const READ = `
  SELECT job.id, job.subject_id, job.status, job.error_code, job.created_at, job.updated_at,
         CASE WHEN job.status = 'running'
              THEN greatest(1, ceil(extract(epoch FROM job.lease_until - clock_timestamp())))::integer
         END AS retry_after_seconds,
         CASE WHEN job.status = 'succeeded' THEN result.output_json ->> 'assessment' END AS assessment
  FROM app.ai_job AS job
  LEFT JOIN app.review_moderation AS result ON result.job_id = job.id
  WHERE job.id = $1 AND job.type = 'review_moderation'`;

interface JobRow {
  readonly id: AiJobId;
  readonly subject_id: ReviewId;
  readonly status: ModerationJobRecord["status"];
  readonly error_code: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly retry_after_seconds: number | null;
  readonly assessment: string | null;
}

export function createModerationJobReadRepository(deps: { sql: Sql }): ModerationJobReadRepository {
  const { sql } = deps;
  return {
    async read(tx, jobId) {
      const row = (await sql.query<JobRow>(tx, READ, [jobId]))[0];
      return row === undefined
        ? null
        : {
            id: row.id,
            reviewId: row.subject_id,
            status: row.status,
            retryAfterSeconds: row.retry_after_seconds,
            assessment: row.assessment,
            errorCode: row.error_code,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
    },
  };
}
