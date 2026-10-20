import "server-only";

import type { Database } from "../../db";
import type { AdminMovieRecord, AdminMovieRepository } from "../../repositories/catalogue";
import type { MovieId, MovieUpdateLock, Result, RowVersion, Tx } from "../../shared";
import type { AuditAction, AuditLog } from "../audit";
import {
  toAdminMovie,
  type AdminActor,
  type AdminMovie,
  type MovieLocks,
  type MovieWriteRejection,
  type ReviewsChangedMarker,
} from "../catalogue";

/**
 * The K8 operation this orchestrator needs (workflow/contracts.md §11): every Review of the Movie
 * `FOR UPDATE` in ascending id order. Developer A's Reviews module (U-02) provides the implementation.
 */
export interface ReviewsOfMovieLock {
  lockReviewsOfMovie(tx: Tx, movie: MovieUpdateLock): Promise<void>;
}

/** Movie archive and restore (FR-05, INV-05, INV-09; contracts §3.3, D-79, D-81, P-12). */
export interface MovieArchiveService {
  /** Returns the resulting version, unchanged for a no-op. */
  archive(movieId: MovieId, expected: RowVersion, actor: AdminActor): Promise<Result<RowVersion, MovieWriteRejection>>;
  /** Returns the resulting Admin Movie, unchanged for a no-op. */
  restore(movieId: MovieId, expected: RowVersion, actor: AdminActor): Promise<Result<AdminMovie, MovieWriteRejection>>;
}

export interface MovieArchiveDependencies {
  readonly database: Pick<Database, "withTransactionResult">;
  readonly movies: Pick<AdminMovieRepository, "findById" | "archive" | "restore">;
  readonly movieLocks: Pick<MovieLocks, "lockMovieForUpdate">;
  readonly reviewLocks: ReviewsOfMovieLock;
  readonly marker: ReviewsChangedMarker;
  readonly auditLog: AuditLog;
}

/** One direction of the archive-state transition. */
interface Transition {
  readonly action: Extract<AuditAction, "movie.archive" | "movie.restore">;
  readonly archivedAfter: boolean;
  readonly write: (tx: Tx, movieId: string) => Promise<AdminMovieRecord>;
}

export function createMovieArchiveService(deps: MovieArchiveDependencies): MovieArchiveService {
  const { database, movies, movieLocks, reviewLocks, marker, auditLog } = deps;

  const transition = (movieId: MovieId, expected: RowVersion, actor: AdminActor, step: Transition) =>
    database.withTransactionResult<AdminMovieRecord, MovieWriteRejection>(async (tx) => {
      // 1. Movie FOR UPDATE (position 2, D-20). The row read below runs under that lock.
      const locked = await movieLocks.lockMovieForUpdate(tx, movieId);
      if (!locked.ok) {
        return locked;
      }
      const current = await movies.findById(tx, movieId);
      if (current === null) {
        throw new Error("locked movie no longer exists");
      }
      // 2. If-Match precedes the no-op decision (D-79, D-81).
      if (current.version !== expected) {
        return { ok: false, error: { kind: "stale_version" } };
      }
      const archivedBefore = current.archivedAt !== null;
      let saved = current;
      if (archivedBefore !== step.archivedAfter) {
        // An actual transition: Reviews FOR UPDATE (position 3), then the write and the marker. A no-op
        // changes no eligibility, so it skips all three and preserves version, timestamps and markers.
        await reviewLocks.lockReviewsOfMovie(tx, locked.value);
        saved = await step.write(tx, movieId);
        await marker.markReviewsChanged(tx, locked.value);
      }
      await auditLog.record(tx, {
        actorId: actor.actorId,
        action: step.action,
        targetType: "movie",
        targetId: movieId,
        result: saved === current ? "no_op" : "applied",
        metadata: {
          previousVersion: current.version,
          newVersion: saved.version,
          archivedBefore,
          archivedAfter: step.archivedAfter,
        },
        requestId: actor.requestId,
      });
      return { ok: true, value: saved };
    });

  const archiveStep: Transition = { action: "movie.archive", archivedAfter: true, write: movies.archive };
  const restoreStep: Transition = { action: "movie.restore", archivedAfter: false, write: movies.restore };

  return {
    async archive(movieId, expected, actor) {
      const result = await transition(movieId, expected, actor, archiveStep);
      return result.ok ? { ok: true, value: result.value.version as RowVersion } : result;
    },
    async restore(movieId, expected, actor) {
      const result = await transition(movieId, expected, actor, restoreStep);
      return result.ok ? { ok: true, value: toAdminMovie(result.value) } : result;
    },
  };
}
