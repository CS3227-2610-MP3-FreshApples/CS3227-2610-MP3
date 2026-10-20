import type { Sql } from "../../../src/server/db";
import type { ReviewsOfMovieLock } from "../../../src/server/services/catalogue-archive";
import type { MovieId } from "../../../src/server/shared";

/** A K8 `lockReviewsOfMovie` stand-in that records each call. */
export interface RecordingReviewsOfMovieLock extends ReviewsOfMovieLock {
  readonly calls: MovieId[];
}

/**
 * Interim K8 stand-in for archive/restore tests until U-02 (Developer A) merges the real
 * `lockReviewsOfMovie` (workflow/contracts.md §11). It takes the same locks the contract names: every
 * Review of the Movie `FOR UPDATE` in ascending id order (D-20, D-79). Replace it with the real K8 once
 * U-02 is on `master`.
 */
export function createPostgresReviewsOfMovieLockStandIn(sql: Sql): RecordingReviewsOfMovieLock {
  const calls: MovieId[] = [];
  return {
    calls,
    async lockReviewsOfMovie(tx, movie) {
      calls.push(movie.movieId);
      await sql.query(tx, "SELECT id FROM app.review WHERE movie_id = $1 ORDER BY id FOR UPDATE", [movie.movieId]);
    },
  };
}
