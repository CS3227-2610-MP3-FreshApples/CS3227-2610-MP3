import "server-only";

import type { Sql } from "../../db";
import type { Tx } from "../../shared";

/** A Movie row as seen under a `FOR UPDATE` lock. */
export interface LockedMovieRow {
  readonly archived: boolean;
  readonly reviewsRevision: number;
}

/** A Movie row as seen under a `FOR SHARE` lock. */
export interface SharedMovieRow {
  readonly archived: boolean;
}

/**
 * K7 access to app.movie (D-51). Lock statements filter on `id` only: under READ COMMITTED, PostgreSQL
 * re-evaluates the WHERE clause against a row a racing transaction committed while this one waited, so a
 * filter on `archived_at` would turn a racing archive into "no row" instead of an archived row.
 */
export interface MovieRepository {
  /** `null` when no Movie has `movieId`. */
  lockForUpdate(tx: Tx, movieId: string): Promise<LockedMovieRow | null>;
  /** `null` when no Movie has `movieId`. */
  lockForShare(tx: Tx, movieId: string): Promise<SharedMovieRow | null>;
  /** Returns the new revision. Throws when the Movie does not exist. */
  advanceReviewsRevision(tx: Tx, movieId: string): Promise<number>;
  /** Throws when the Movie does not exist. */
  recordSummaryAttempt(tx: Tx, movieId: string, nextAttemptAt: Date): Promise<void>;
  /** Returns whether the Movie was active at `publishedRevision` and so was written. */
  recordSummaryPublished(tx: Tx, movieId: string, publishedRevision: number): Promise<boolean>;
}

const LOCK_FOR_UPDATE = `
  SELECT archived_at IS NOT NULL AS archived, reviews_revision
  FROM app.movie WHERE id = $1
  FOR UPDATE`;

const LOCK_FOR_SHARE = `
  SELECT archived_at IS NOT NULL AS archived
  FROM app.movie WHERE id = $1
  FOR SHARE`;

// D-51: leaves `version` and the summary attempt columns unchanged, and keeps the oldest pending time.
const ADVANCE_REVIEWS_REVISION = `
  UPDATE app.movie
  SET reviews_revision = reviews_revision + 1,
      summary_pending_since = coalesce(summary_pending_since, now()),
      updated_at = now()
  WHERE id = $1
  RETURNING reviews_revision`;

const RECORD_SUMMARY_ATTEMPT = `
  UPDATE app.movie
  SET summary_last_attempt_at = now(), summary_next_attempt_at = $2, updated_at = now()
  WHERE id = $1
  RETURNING 1`;

// D-51: leaves `summary_next_attempt_at` as the attempt set it.
const RECORD_SUMMARY_PUBLISHED = `
  UPDATE app.movie
  SET summary_pending_since = NULL, summary_last_success_at = now(), updated_at = now()
  WHERE id = $1 AND archived_at IS NULL AND reviews_revision = $2
  RETURNING 1`;

export function createMovieRepository(deps: { sql: Sql }): MovieRepository {
  const { sql } = deps;
  return {
    async lockForUpdate(tx, movieId) {
      const rows = await sql.query<{ archived: boolean; reviews_revision: number }>(tx, LOCK_FOR_UPDATE, [movieId]);
      const row = rows[0];
      return row === undefined ? null : { archived: row.archived, reviewsRevision: row.reviews_revision };
    },
    async lockForShare(tx, movieId) {
      const rows = await sql.query<{ archived: boolean }>(tx, LOCK_FOR_SHARE, [movieId]);
      const row = rows[0];
      return row === undefined ? null : { archived: row.archived };
    },
    async advanceReviewsRevision(tx, movieId) {
      const rows = await sql.query<{ reviews_revision: number }>(tx, ADVANCE_REVIEWS_REVISION, [movieId]);
      const row = rows[0];
      if (row === undefined) {
        throw new Error("locked movie no longer exists");
      }
      return row.reviews_revision;
    },
    async recordSummaryAttempt(tx, movieId, nextAttemptAt) {
      const rows = await sql.query(tx, RECORD_SUMMARY_ATTEMPT, [movieId, nextAttemptAt]);
      if (rows.length === 0) {
        throw new Error("locked movie no longer exists");
      }
    },
    async recordSummaryPublished(tx, movieId, publishedRevision) {
      const rows = await sql.query(tx, RECORD_SUMMARY_PUBLISHED, [movieId, publishedRevision]);
      return rows.length > 0;
    },
  };
}
