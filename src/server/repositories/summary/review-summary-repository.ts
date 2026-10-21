import "server-only";

import type { Sql } from "../../db";
import type { AiJobId, MovieId, ReviewsRevision, Tx } from "../../shared";
import { currentSummaryExists } from "./current-summary";

/** A validated summary to insert. The JSON values are serialized by the caller (D-88). */
export interface NewReviewSummary {
  readonly jobId: AiJobId;
  readonly movieId: MovieId;
  readonly reviewsRevision: ReviewsRevision;
  /** `sampled_review_ids_and_versions`: the included sample, with no Review text (D-88). */
  readonly sampleJson: string;
  readonly eligibleCount: number;
  /** The validated D-87 output. */
  readonly outputJson: string;
}

/** ReviewSummary writes for summary publication (D-92). Called inside K10's publish Tx under the Movie lock. */
export interface ReviewSummaryRepository {
  /** Whether a ReviewSummary exists at `reviewsRevision` from a job with `promptVersion` (D-93). */
  existsCurrent(tx: Tx, movieId: MovieId, reviewsRevision: ReviewsRevision, promptVersion: string): Promise<boolean>;
  /** Inserts one ReviewSummary; `generated_at` is the transaction's `now()` (D-88). */
  insert(tx: Tx, summary: NewReviewSummary): Promise<void>;
}

const EXISTS_CURRENT = `
  SELECT ${currentSummaryExists({ movieId: "$1", reviewsRevision: "$2", promptVersion: "$3" })} AS exists`;

const INSERT = `
  INSERT INTO app.review_summary
    (job_id, movie_id, reviews_revision, sampled_review_ids_and_versions, eligible_count, output_json, generated_at)
  VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, now())`;

export function createReviewSummaryRepository(deps: { readonly sql: Sql }): ReviewSummaryRepository {
  return {
    async existsCurrent(tx, movieId, reviewsRevision, promptVersion) {
      const rows = await deps.sql.query<{ exists: boolean }>(tx, EXISTS_CURRENT, [movieId, reviewsRevision, promptVersion]);
      return rows[0]?.exists === true;
    },
    async insert(tx, summary) {
      await deps.sql.query(tx, INSERT, [
        summary.jobId,
        summary.movieId,
        summary.reviewsRevision,
        summary.sampleJson,
        summary.eligibleCount,
        summary.outputJson,
      ]);
    },
  };
}
