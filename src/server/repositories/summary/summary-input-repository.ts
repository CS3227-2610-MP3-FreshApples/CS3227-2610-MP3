import "server-only";

import type { Sql } from "../../db";
import type { ContentRevision, MovieId, ReviewId, ReviewsRevision, RowVersion, Tx } from "../../shared";
import { currentSummaryExists } from "./current-summary";

/** An eligible Review as the summary reads it: no author, report or moderation fields (D-86). */
export interface EligibleReviewRecord {
  readonly id: ReviewId;
  readonly version: RowVersion;
  readonly contentRevision: ContentRevision;
  readonly rating: number;
  readonly body: string;
}

/** One statement's view of an active Movie, so the revision always matches the Review set (D-86). */
export interface SummaryInputSnapshot {
  readonly reviewsRevision: ReviewsRevision;
  /** A ReviewSummary exists at `reviewsRevision` from a job with the given prompt version (D-88, D-93). */
  readonly hasCurrentSummary: boolean;
  /** Every eligible Review, in ascending `id` order. */
  readonly reviews: readonly EligibleReviewRecord[];
}

/** Read-only storage boundary for summary input (D-86, O-23). Takes no row lock. */
export interface SummaryInputRepository {
  /** Returns null for a missing or archived Movie. */
  readSnapshot(tx: Tx, movieId: MovieId, promptVersion: string): Promise<SummaryInputSnapshot | null>;
}

interface ReviewJson {
  readonly id: ReviewId;
  readonly version: RowVersion;
  readonly content_revision: ContentRevision;
  readonly rating: number;
  readonly body: string;
}

interface SnapshotRow {
  readonly reviews_revision: ReviewsRevision;
  readonly has_current_summary: boolean;
  readonly reviews: ReviewJson[];
}

// The eligibility predicate restates U-01's (data-model.md; D-86); the parity test keeps the copies aligned.
const READ_SNAPSHOT = `
  SELECT m.reviews_revision,
         ${currentSummaryExists({ movieId: "m.id", reviewsRevision: "m.reviews_revision", promptVersion: "$2" })}
           AS has_current_summary,
         COALESCE((
           SELECT json_agg(
                    json_build_object(
                      'id', r.id,
                      'version', r.version,
                      'content_revision', r.content_revision,
                      'rating', r.rating,
                      'body', r.body)
                    ORDER BY r.id)
           FROM app.review r
           WHERE r.movie_id = m.id
             AND r.moderation_state = 'cleared'
             AND r.deleted_at IS NULL
             AND r.hidden_at IS NULL
         ), '[]'::json) AS reviews
  FROM app.movie m
  WHERE m.id = $1 AND m.archived_at IS NULL`;

export function createSummaryInputRepository(deps: { readonly sql: Sql }): SummaryInputRepository {
  return {
    async readSnapshot(tx, movieId, promptVersion) {
      const rows = await deps.sql.query<SnapshotRow>(tx, READ_SNAPSHOT, [movieId, promptVersion]);
      const row = rows[0];
      return row === undefined
        ? null
        : {
            reviewsRevision: row.reviews_revision,
            hasCurrentSummary: row.has_current_summary,
            reviews: row.reviews.map((review) => ({
              id: review.id,
              version: review.version,
              contentRevision: review.content_revision,
              rating: review.rating,
              body: review.body,
            })),
          };
    },
  };
}
