import "server-only";

import type { Sql } from "../../db";
import { createMovieRepository } from "../../repositories/catalogue";
import type { ReviewsRevision } from "../../shared";
import { movieShareLock, movieUpdateLock } from "./handles";
import type { MovieLocks, ReviewsChangedMarker, SummarySchedule } from "./types";

const NOT_FOUND = { ok: false, error: { kind: "not_found" } } as const;
const ARCHIVED = { ok: false, error: { kind: "archived" } } as const;
const STALE = { ok: false, error: { kind: "stale" } } as const;

/**
 * K7 lock functions (workflow/contracts.md §10, §22 AM-13; D-51). Inside the caller's Tx; the caller may
 * already hold only Account locks (D-20).
 */
export function createMovieLocks(deps: { sql: Sql }): MovieLocks {
  const movies = createMovieRepository({ sql: deps.sql });
  return {
    async lockActiveMovieForUpdate(tx, movieId) {
      const row = await movies.lockForUpdate(tx, movieId);
      if (row === null) {
        return NOT_FOUND;
      }
      return row.archived ? ARCHIVED : { ok: true, value: movieUpdateLock(movieId, false, row.reviewsRevision) };
    },
    async lockActiveMovieShared(tx, movieId) {
      const row = await movies.lockForShare(tx, movieId);
      if (row === null) {
        return NOT_FOUND;
      }
      return row.archived ? ARCHIVED : { ok: true, value: movieShareLock(movieId) };
    },
    async lockMovieForUpdate(tx, movieId) {
      const row = await movies.lockForUpdate(tx, movieId);
      return row === null
        ? NOT_FOUND
        : { ok: true, value: movieUpdateLock(movieId, row.archived, row.reviewsRevision) };
    },
  };
}

/** K7 review-change marker (D-51). The handle proves the caller holds the Movie `FOR UPDATE`. */
export function createReviewsChangedMarker(deps: { sql: Sql }): ReviewsChangedMarker {
  const movies = createMovieRepository({ sql: deps.sql });
  return {
    async markReviewsChanged(tx, movie) {
      return (await movies.advanceReviewsRevision(tx, movie.movieId)) as ReviewsRevision;
    },
  };
}

/** K7 summary-schedule writes (O-20, D-51). The handle proves the caller holds the Movie `FOR UPDATE`. */
export function createSummarySchedule(deps: { sql: Sql }): SummarySchedule {
  const movies = createMovieRepository({ sql: deps.sql });
  return {
    recordSummaryAttempt(tx, movie, nextAttemptAt) {
      return movies.recordSummaryAttempt(tx, movie.movieId, nextAttemptAt);
    },
    async recordSummaryPublished(tx, movie, published) {
      // Checked against the row, not the handle: the handle holds lock-time values, and a marker call in
      // the same Tx may have advanced the revision since.
      return (await movies.recordSummaryPublished(tx, movie.movieId, published)) ? { ok: true, value: undefined } : STALE;
    },
  };
}
