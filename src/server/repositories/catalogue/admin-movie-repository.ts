import "server-only";

import type { Sql } from "../../db";
import type { Tx } from "../../shared";

/** Admin-writable Movie metadata (api.md 8.1), already validated and normalized by the caller. */
export interface MovieMetadata {
  readonly title: string;
  readonly synopsis: string;
  readonly releaseDate: string | null; // YYYY-MM-DD
  readonly genres: readonly string[];
  readonly director: string;
  readonly cast: readonly string[];
  readonly runtimeMinutes: number | null;
}

/** A Movie row as the Admin API sees it: metadata, archive state and version, without summary internals. */
export interface AdminMovieRecord extends MovieMetadata {
  readonly id: string;
  readonly archivedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Admin access to app.movie (FR-05, D-79, D-80). Every write increments `version` once and sets
 * `updated_at`; none touches `reviews_revision` or the summary columns, which belong to K7.
 */
export interface AdminMovieRepository {
  insert(tx: Tx, metadata: MovieMetadata): Promise<AdminMovieRecord>;
  /** `null` when no Movie has `movieId`. */
  findById(tx: Tx, movieId: string): Promise<AdminMovieRecord | null>;
  /** `FOR UPDATE`; `null` when no Movie has `movieId`. */
  lockById(tx: Tx, movieId: string): Promise<AdminMovieRecord | null>;
  /** Ordered by updated_at DESC, id ASC (D-80), archived Movies included. */
  list(tx: Tx, limit: number, offset: number): Promise<readonly AdminMovieRecord[]>;
  count(tx: Tx): Promise<number>;
  /** Throws when the Movie does not exist; the caller holds its lock. */
  updateMetadata(tx: Tx, movieId: string, metadata: MovieMetadata): Promise<AdminMovieRecord>;
  /** Sets archived_at; throws when the Movie does not exist. */
  archive(tx: Tx, movieId: string): Promise<AdminMovieRecord>;
  /** Clears archived_at; throws when the Movie does not exist. */
  restore(tx: Tx, movieId: string): Promise<AdminMovieRecord>;
}

const COLUMNS = `id, title, synopsis, release_date, genres, director, "cast", runtime_minutes, archived_at, version,
  created_at, updated_at`;

const INSERT = `
  INSERT INTO app.movie (title, synopsis, release_date, genres, director, "cast", runtime_minutes)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING ${COLUMNS}`;

const FIND_BY_ID = `SELECT ${COLUMNS} FROM app.movie WHERE id = $1`;

const LOCK_BY_ID = `SELECT ${COLUMNS} FROM app.movie WHERE id = $1 FOR UPDATE`;

const LIST = `SELECT ${COLUMNS} FROM app.movie ORDER BY updated_at DESC, id ASC LIMIT $1 OFFSET $2`;

const COUNT = "SELECT count(*)::int AS total FROM app.movie";

const UPDATE_METADATA = `
  UPDATE app.movie
  SET title = $2, synopsis = $3, release_date = $4, genres = $5, director = $6, "cast" = $7, runtime_minutes = $8,
      version = version + 1, updated_at = now()
  WHERE id = $1
  RETURNING ${COLUMNS}`;

const ARCHIVE = `
  UPDATE app.movie SET archived_at = now(), version = version + 1, updated_at = now()
  WHERE id = $1
  RETURNING ${COLUMNS}`;

const RESTORE = `
  UPDATE app.movie SET archived_at = NULL, version = version + 1, updated_at = now()
  WHERE id = $1
  RETURNING ${COLUMNS}`;

interface MovieRow {
  readonly id: string;
  readonly title: string;
  readonly synopsis: string;
  readonly release_date: string | null;
  readonly genres: string[];
  readonly director: string;
  readonly cast: string[];
  readonly runtime_minutes: number | null;
  readonly archived_at: Date | null;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function toRecord(row: MovieRow): AdminMovieRecord {
  return {
    id: row.id,
    title: row.title,
    synopsis: row.synopsis,
    releaseDate: row.release_date,
    genres: row.genres,
    director: row.director,
    cast: row.cast,
    runtimeMinutes: row.runtime_minutes,
    archivedAt: row.archived_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function onlyRecord(rows: readonly MovieRow[]): AdminMovieRecord {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("locked movie no longer exists");
  }
  return toRecord(row);
}

export function createAdminMovieRepository(deps: { sql: Sql }): AdminMovieRepository {
  const { sql } = deps;
  const metadataParams = (metadata: MovieMetadata) => [
    metadata.title,
    metadata.synopsis,
    metadata.releaseDate,
    metadata.genres,
    metadata.director,
    metadata.cast,
    metadata.runtimeMinutes,
  ];
  return {
    async insert(tx, metadata) {
      return onlyRecord(await sql.query<MovieRow>(tx, INSERT, metadataParams(metadata)));
    },
    async findById(tx, movieId) {
      const row = (await sql.query<MovieRow>(tx, FIND_BY_ID, [movieId]))[0];
      return row === undefined ? null : toRecord(row);
    },
    async lockById(tx, movieId) {
      const row = (await sql.query<MovieRow>(tx, LOCK_BY_ID, [movieId]))[0];
      return row === undefined ? null : toRecord(row);
    },
    async list(tx, limit, offset) {
      return (await sql.query<MovieRow>(tx, LIST, [limit, offset])).map(toRecord);
    },
    async count(tx) {
      return (await sql.query<{ total: number }>(tx, COUNT, []))[0]?.total ?? 0;
    },
    async updateMetadata(tx, movieId, metadata) {
      return onlyRecord(await sql.query<MovieRow>(tx, UPDATE_METADATA, [movieId, ...metadataParams(metadata)]));
    },
    async archive(tx, movieId) {
      return onlyRecord(await sql.query<MovieRow>(tx, ARCHIVE, [movieId]));
    },
    async restore(tx, movieId) {
      return onlyRecord(await sql.query<MovieRow>(tx, RESTORE, [movieId]));
    },
  };
}
