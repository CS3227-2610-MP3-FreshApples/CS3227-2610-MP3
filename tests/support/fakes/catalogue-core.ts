import type { MovieLocks, ReviewsChangedMarker, SummarySchedule } from "../../../src/server/services/catalogue";
import { movieShareLock, movieUpdateLock } from "../../../src/server/services/catalogue/handles";
import type { MovieId, ReviewsRevision } from "../../../src/server/shared";
import type { MovieSeed, StoredMovie } from "../contracts/catalogue-core.contract";

export interface MarkCall {
  readonly movieId: MovieId;
  /** The revision `markReviewsChanged` returned. */
  readonly revision: number;
}

export interface FakeCatalogueCore {
  readonly locks: MovieLocks;
  readonly marker: ReviewsChangedMarker;
  readonly schedule: SummarySchedule;
  /** Stores a Movie the lock functions can find. Unseeded Movies are `not_found`. */
  seedMovie(movieId: MovieId, seed?: MovieSeed): void;
  /** The stored state of a seeded Movie; throws for an unseeded one. */
  stored(movieId: MovieId): StoredMovie;
  /** Every `markReviewsChanged` call, in call order. */
  readonly markCalls: readonly MarkCall[];
}

/** A seeded `updatedAt`, before any test run, so any write is visible. */
const SEEDED_UPDATED_AT = new Date("2026-01-01T00:00:00.000Z");

/**
 * K7 fake (workflow/contracts.md §1 rule 6, §10; D-51). Fails closed: every lock function returns
 * `not_found` unless a test seeds the Movie. It writes the same columns as the real module and records
 * marker calls. It has no transactions or row locks: rollback and lock-wait behaviour need PostgreSQL (D-10).
 * Times come from `now`, which defaults to the system clock.
 */
export function createFakeCatalogueCore(deps: { now?: () => Date } = {}): FakeCatalogueCore {
  const now = deps.now ?? (() => new Date());
  const movies = new Map<MovieId, StoredMovie>();
  const markCalls: MarkCall[] = [];

  function write(movieId: MovieId, changes: Partial<StoredMovie>): StoredMovie {
    const movie = movies.get(movieId);
    if (movie === undefined) {
      throw new Error("locked movie no longer exists");
    }
    const updated = { ...movie, ...changes };
    movies.set(movieId, updated);
    return updated;
  }

  return {
    markCalls,
    seedMovie(movieId, seed = {}) {
      movies.set(movieId, {
        archived: seed.archived ?? false,
        reviewsRevision: seed.reviewsRevision ?? 0,
        version: 1,
        summaryPendingSince: seed.summaryPendingSince ?? null,
        summaryNextAttemptAt: seed.summaryNextAttemptAt ?? null,
        summaryLastAttemptAt: seed.summaryLastAttemptAt ?? null,
        summaryLastSuccessAt: null,
        updatedAt: SEEDED_UPDATED_AT,
      });
    },
    stored(movieId) {
      const movie = movies.get(movieId);
      if (movie === undefined) {
        throw new Error("movie not seeded");
      }
      return { ...movie };
    },
    locks: {
      async lockActiveMovieForUpdate(_tx, movieId) {
        const movie = movies.get(movieId);
        if (movie === undefined) {
          return { ok: false, error: { kind: "not_found" } };
        }
        return movie.archived
          ? { ok: false, error: { kind: "archived" } }
          : { ok: true, value: movieUpdateLock(movieId, false, movie.reviewsRevision) };
      },
      async lockActiveMovieShared(_tx, movieId) {
        const movie = movies.get(movieId);
        if (movie === undefined) {
          return { ok: false, error: { kind: "not_found" } };
        }
        return movie.archived ? { ok: false, error: { kind: "archived" } } : { ok: true, value: movieShareLock(movieId) };
      },
      async lockMovieForUpdate(_tx, movieId) {
        const movie = movies.get(movieId);
        return movie === undefined
          ? { ok: false, error: { kind: "not_found" } }
          : { ok: true, value: movieUpdateLock(movieId, movie.archived, movie.reviewsRevision) };
      },
    },
    marker: {
      async markReviewsChanged(_tx, lock) {
        const movie = movies.get(lock.movieId);
        const at = now();
        const updated = write(lock.movieId, {
          reviewsRevision: (movie?.reviewsRevision ?? 0) + 1,
          summaryPendingSince: movie?.summaryPendingSince ?? at,
          updatedAt: at,
        });
        markCalls.push({ movieId: lock.movieId, revision: updated.reviewsRevision });
        return updated.reviewsRevision as ReviewsRevision;
      },
    },
    schedule: {
      async recordSummaryAttempt(_tx, lock, nextAttemptAt) {
        const at = now();
        write(lock.movieId, { summaryLastAttemptAt: at, summaryNextAttemptAt: nextAttemptAt, updatedAt: at });
      },
      async recordSummaryPublished(_tx, lock, published) {
        const movie = movies.get(lock.movieId);
        if (movie === undefined || movie.archived || movie.reviewsRevision !== published) {
          return { ok: false, error: { kind: "stale" } };
        }
        const at = now();
        write(lock.movieId, { summaryPendingSince: null, summaryLastSuccessAt: at, updatedAt: at });
        return { ok: true, value: undefined };
      },
    },
  };
}
