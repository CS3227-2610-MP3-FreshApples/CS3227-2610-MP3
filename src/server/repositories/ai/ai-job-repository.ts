import "server-only";

import type { Sql } from "../../db";
import type { Tx } from "../../shared";

/** The D-64 column values of a new running AIJob. */
export interface NewAiJob {
  readonly type: "summary" | "review_moderation";
  readonly trigger: "scheduler" | "review_write" | "admin_request";
  readonly requesterId: string | null;
  readonly subjectId: string;
  readonly inputRevision: number;
  readonly dedupKey: string;
  readonly leaseUntil: Date;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly policyVersion: string | null;
  readonly inputHash: string;
  /** `bounded_input_snapshot`, already serialized as JSON. */
  readonly snapshotJson: string;
}

export type InsertedAiJob =
  | { readonly inserted: true; readonly jobId: string }
  /** A running job already holds the dedup key (`ai_job_running_dedup_key_key`, D-66). */
  | { readonly inserted: false; readonly runningJobId: string };

/** A final status written by the settlement transaction (D-73). */
export interface FinalJobStatus {
  readonly status: "failed" | "stale";
  readonly attemptCount: number;
  readonly errorCode: string;
}

/**
 * K10 access to app.ai_job (D-64, D-66, D-73). Rows are locked only through UPDATE or the same no-key-update
 * mode, never `FOR UPDATE`, so a publish callback's foreign-key share lock never blocks them (D-73). Lease
 * comparisons use `clock_timestamp()` or a cutoff taken from it (D-73).
 */
export interface AiJobRepository {
  /** Inserts a `running` job with `attempt_count` 0 and `expires_at` = `created_at` + 7 days (D-64). */
  insertRunning(tx: Tx, job: NewAiJob): Promise<InsertedAiJob>;
  /** Marks `stale`/`lease_expired` every running job whose lease ended by `cutoff`, in ascending ID order (D-66). */
  expireLapsed(tx: Tx, cutoff: Date): Promise<void>;
  /** P-08: sets `succeeded` only while the job is running and its lease has not passed (D-73). */
  markSucceeded(tx: Tx, jobId: string, attemptCount: number): Promise<boolean>;
  /** Writes `failed` or `stale` only while the job is still running (D-73). */
  markFinal(tx: Tx, jobId: string, final: FinalJobStatus): Promise<void>;
}

const INSERT_RUNNING = `
  INSERT INTO app.ai_job
    (type, trigger, requester_id, subject_id, input_revision, dedup_key, status, attempt_count, lease_until,
     expires_at, model_id, prompt_version, policy_version, input_hash, bounded_input_snapshot, error_code,
     created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, 'running', 0, $7, now() + interval '7 days', $8, $9, $10, $11, $12::jsonb, NULL,
    now(), now())
  ON CONFLICT (dedup_key) WHERE status = 'running' DO NOTHING
  RETURNING id`;

const RUNNING_WITH_DEDUP_KEY = "SELECT id FROM app.ai_job WHERE dedup_key = $1 AND status = 'running'";

// FOR NO KEY UPDATE is the row lock UPDATE itself takes (D-73); the CTE only fixes the ascending order (D-66).
const EXPIRE_LAPSED = `
  WITH lapsed AS (
    SELECT id FROM app.ai_job
    WHERE status = 'running' AND lease_until <= $1::timestamptz
    ORDER BY id
    FOR NO KEY UPDATE
  )
  UPDATE app.ai_job AS job
  SET status = 'stale', error_code = 'lease_expired', updated_at = now()
  FROM lapsed
  WHERE job.id = lapsed.id AND job.status = 'running'`;

const MARK_SUCCEEDED = `
  UPDATE app.ai_job
  SET status = 'succeeded', attempt_count = $2, error_code = NULL, updated_at = now()
  WHERE id = $1 AND status = 'running' AND lease_until > clock_timestamp()
  RETURNING 1 AS succeeded`;

const MARK_FINAL = `
  UPDATE app.ai_job
  SET status = $2, attempt_count = $3, error_code = $4, updated_at = now()
  WHERE id = $1 AND status = 'running'`;

export function createAiJobRepository(deps: { sql: Sql }): AiJobRepository {
  const { sql } = deps;
  return {
    async insertRunning(tx, job) {
      const inserted = await sql.query<{ id: string }>(tx, INSERT_RUNNING, [
        job.type,
        job.trigger,
        job.requesterId,
        job.subjectId,
        job.inputRevision,
        job.dedupKey,
        job.leaseUntil,
        job.modelId,
        job.promptVersion,
        job.policyVersion,
        job.inputHash,
        job.snapshotJson,
      ]);
      const id = inserted[0]?.id;
      if (id !== undefined) {
        return { inserted: true, jobId: id };
      }
      const running = (await sql.query<{ id: string }>(tx, RUNNING_WITH_DEDUP_KEY, [job.dedupKey]))[0];
      if (running === undefined) {
        // The conflicting job finished between the two statements; step 1 treats this as a fault (D-75).
        throw new Error("dedup conflict without a running job");
      }
      return { inserted: false, runningJobId: running.id };
    },
    async expireLapsed(tx, cutoff) {
      await sql.query(tx, EXPIRE_LAPSED, [cutoff]);
    },
    async markSucceeded(tx, jobId, attemptCount) {
      return (await sql.query(tx, MARK_SUCCEEDED, [jobId, attemptCount])).length === 1;
    },
    async markFinal(tx, jobId, final) {
      await sql.query(tx, MARK_FINAL, [jobId, final.status, final.attemptCount, final.errorCode]);
    },
  };
}
