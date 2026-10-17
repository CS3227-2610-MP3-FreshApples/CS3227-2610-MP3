import "server-only";

import type { MovieId, MovieShareLock, MovieUpdateLock, Result, ReviewsRevision, Tx } from "../../shared";

export type MovieUnavailable = { readonly kind: "not_found" } | { readonly kind: "archived" };
export type MovieNotFound = { readonly kind: "not_found" };
export type SummaryStale = { readonly kind: "stale" };

/**
 * K7 lock functions (workflow/contracts.md §10; D-51). Each runs inside the caller's Tx and takes the Movie
 * row lock (position 2, D-20) before it checks `archived_at`, so `archived` is reported while the lock is
 * held and the caller rolls back.
 */
export interface MovieLocks {
  /** `FOR UPDATE`. Review writes and summary publication. */
  lockActiveMovieForUpdate(tx: Tx, movieId: MovieId): Promise<Result<MovieUpdateLock, MovieUnavailable>>;
  /** `FOR SHARE`. Report submission. */
  lockActiveMovieShared(tx: Tx, movieId: MovieId): Promise<Result<MovieShareLock, MovieUnavailable>>;
  /** `FOR UPDATE` in any archive state. Used by K8. */
  lockMovieForUpdate(tx: Tx, movieId: MovieId): Promise<Result<MovieUpdateLock, MovieNotFound>>;
}

export interface ReviewsChangedMarker {
  /**
   * reviews_revision + 1; summary_pending_since = coalesce(existing, now()); updated_at = now(). Returns the
   * new revision. Leaves `Movie.version` and the summary attempt columns unchanged, and does not inspect
   * `movie.archived` (D-51). Call it only as contracts §10 and AM-13 allow.
   */
  markReviewsChanged(tx: Tx, movie: MovieUpdateLock): Promise<ReviewsRevision>;
}

/** Summary-schedule writes to the Movie summary_* columns (O-20, D-51). */
export interface SummarySchedule {
  /** Sets summary_last_attempt_at = now(), summary_next_attempt_at = `nextAttemptAt` and updated_at. */
  recordSummaryAttempt(tx: Tx, movie: MovieUpdateLock, nextAttemptAt: Date): Promise<void>;
  /**
   * Clears pending and sets summary_last_success_at only if the Movie is active and its reviews_revision
   * equals `published`; otherwise returns `stale` and writes nothing.
   */
  recordSummaryPublished(tx: Tx, movie: MovieUpdateLock, published: ReviewsRevision): Promise<Result<void, SummaryStale>>;
}
