import "server-only";

import type { Database } from "../../db";
import type { AdminMovieRecord, AdminMovieRepository, MovieMetadata } from "../../repositories/catalogue";
import type { AccountId, MovieId, RequestId, Result, RowVersion } from "../../shared";
import type { AuditLog } from "../audit";
import type { MovieCreateInput, MoviePatchInput } from "./movie-input";
import type { MovieNotFound } from "./types";

/** The Admin Movie resource (api.md 8.1 "current metadata, archive state, version"). */
export interface AdminMovie {
  readonly id: MovieId;
  readonly title: string;
  readonly synopsis: string;
  readonly releaseDate: string | null;
  readonly genres: readonly string[];
  readonly director: string;
  readonly cast: readonly string[];
  readonly runtimeMinutes: number | null;
  readonly archivedAt: string | null;
  readonly version: RowVersion;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Who performs an Admin mutation, for the K5 entry. Both are server-derived (D-81). */
export interface AdminActor {
  readonly actorId: AccountId;
  readonly requestId: RequestId;
}

export type MovieWriteRejection = MovieNotFound | { readonly kind: "stale_version" };

export interface AdminMoviePage {
  readonly items: readonly AdminMovie[];
  readonly total: number;
}

/** FR-05 Movie reads and metadata writes. Archive and restore are the orchestrator's (P-12). */
export interface AdminMovieService {
  list(page: number, pageSize: number): Promise<AdminMoviePage>;
  get(movieId: MovieId): Promise<Result<AdminMovie, MovieNotFound>>;
  create(input: MovieCreateInput, actor: AdminActor): Promise<AdminMovie>;
  update(movieId: MovieId, expected: RowVersion, changes: MoviePatchInput, actor: AdminActor):
    Promise<Result<AdminMovie, MovieWriteRejection>>;
}

export interface AdminMovieDependencies {
  readonly database: Pick<Database, "withTransaction" | "withTransactionResult">;
  readonly movies: Pick<AdminMovieRepository, "insert" | "findById" | "lockById" | "list" | "count" | "updateMetadata">;
  readonly auditLog: AuditLog;
}

const METADATA_FIELDS = ["title", "synopsis", "releaseDate", "genres", "director", "cast", "runtimeMinutes"] as const;

export function toAdminMovie(record: AdminMovieRecord): AdminMovie {
  return {
    id: record.id as MovieId,
    title: record.title,
    synopsis: record.synopsis,
    releaseDate: record.releaseDate,
    genres: record.genres,
    director: record.director,
    cast: record.cast,
    runtimeMinutes: record.runtimeMinutes,
    archivedAt: record.archivedAt === null ? null : record.archivedAt.toISOString(),
    version: record.version as RowVersion,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function sameValue(left: MovieMetadata[keyof MovieMetadata], right: MovieMetadata[keyof MovieMetadata]): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    // Order-sensitive; arrays are neither sorted nor deduplicated (D-80).
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
  }
  return left === right;
}

export function createAdminMovieService(deps: AdminMovieDependencies): AdminMovieService {
  const { database, movies, auditLog } = deps;
  return {
    list(page, pageSize) {
      return database.withTransaction(async (tx) => {
        const total = await movies.count(tx);
        const offset = (page - 1) * pageSize;
        // An out-of-range page returns no items and the actual total (D-80); skip the query entirely.
        const records = offset >= total ? [] : await movies.list(tx, pageSize, offset);
        return { items: records.map(toAdminMovie), total };
      });
    },

    get(movieId) {
      return database.withTransactionResult(async (tx) => {
        const record = await movies.findById(tx, movieId);
        return record === null ? { ok: false, error: { kind: "not_found" } } : { ok: true, value: toAdminMovie(record) };
      });
    },

    create(input, actor) {
      return database.withTransaction(async (tx) => {
        const record = await movies.insert(tx, input);
        await auditLog.record(tx, {
          actorId: actor.actorId,
          action: "movie.create",
          targetType: "movie",
          targetId: record.id,
          result: "applied",
          metadata: { newVersion: record.version },
          requestId: actor.requestId,
        });
        return toAdminMovie(record);
      });
    },

    update(movieId, expected, changes, actor) {
      return database.withTransactionResult<AdminMovie, MovieWriteRejection>(async (tx) => {
        const current = await movies.lockById(tx, movieId);
        if (current === null) {
          return { ok: false, error: { kind: "not_found" } };
        }
        // The version check precedes the no-op decision (D-79, D-81).
        if (current.version !== expected) {
          return { ok: false, error: { kind: "stale_version" } };
        }
        const next: MovieMetadata = { ...pickMetadata(current), ...changes };
        const changed = METADATA_FIELDS.filter((field) => !sameValue(current[field], next[field]));
        const saved = changed.length === 0 ? current : await movies.updateMetadata(tx, movieId, next);
        await auditLog.record(tx, {
          actorId: actor.actorId,
          action: "movie.update",
          targetType: "movie",
          targetId: movieId,
          result: changed.length === 0 ? "no_op" : "applied",
          // Changed-field markers only, never the text itself (D-81, D-46).
          metadata: {
            previousVersion: current.version,
            newVersion: saved.version,
            ...Object.fromEntries(changed.map((field) => [`${field}Changed`, true])),
          },
          requestId: actor.requestId,
        });
        return { ok: true, value: toAdminMovie(saved) };
      });
    },
  };
}

function pickMetadata(record: AdminMovieRecord): MovieMetadata {
  return {
    title: record.title,
    synopsis: record.synopsis,
    releaseDate: record.releaseDate,
    genres: record.genres,
    director: record.director,
    cast: record.cast,
    runtimeMinutes: record.runtimeMinutes,
  };
}
