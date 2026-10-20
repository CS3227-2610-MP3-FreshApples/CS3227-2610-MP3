import "server-only";

import type { Sql } from "../../db";
import type { Tx } from "../../shared";

export type AnnouncementState = "draft" | "published" | "deleted";

/** Admin-writable Announcement content (api.md 8.1), already validated and normalized by the caller. */
export interface AnnouncementContent {
  readonly title: string;
  readonly body: string;
  readonly movieId: string | null;
}

export interface AnnouncementRecord extends AnnouncementContent {
  readonly id: string;
  readonly state: AnnouncementState;
  readonly publishedAt: Date | null;
  readonly authorId: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Access to app.announcement (FR-07, D-79, D-80). Every write increments `version` once and sets
 * `updated_at`. Only `publish` sets `published_at`, to the transaction's time; no other write touches it.
 */
export interface AnnouncementRepository {
  /** Inserts a draft with `published_at` null. */
  insertDraft(tx: Tx, content: AnnouncementContent, authorId: string): Promise<AnnouncementRecord>;
  /** `null` when no Announcement has `announcementId`. */
  findById(tx: Tx, announcementId: string): Promise<AnnouncementRecord | null>;
  /** `FOR UPDATE`; `null` when no Announcement has `announcementId`. */
  lockById(tx: Tx, announcementId: string): Promise<AnnouncementRecord | null>;
  /** Every state, ordered by updated_at DESC, id ASC (D-80). */
  list(tx: Tx, limit: number, offset: number): Promise<readonly AnnouncementRecord[]>;
  count(tx: Tx): Promise<number>;
  /** Writes content and state and keeps `published_at`; throws when the Announcement does not exist. */
  update(tx: Tx, announcementId: string, content: AnnouncementContent, state: "draft" | "published"): Promise<AnnouncementRecord>;
  /** Writes content, sets state published and `published_at` = now(); throws when the Announcement does not exist. */
  publish(tx: Tx, announcementId: string, content: AnnouncementContent): Promise<AnnouncementRecord>;
  /** Sets state deleted and keeps `published_at`; throws when the Announcement does not exist. */
  markDeleted(tx: Tx, announcementId: string): Promise<AnnouncementRecord>;
  /**
   * Whether a Movie with `movieId` exists, in any archive state. An unlocked read of Catalogue's table
   * (O-23): Movies are never deleted (D-32), so the answer cannot change before commit.
   */
  movieExists(tx: Tx, movieId: string): Promise<boolean>;
}

const COLUMNS = "id, title, body, movie_id, state, published_at, author_id, version, created_at, updated_at";

const INSERT_DRAFT = `
  INSERT INTO app.announcement (title, body, movie_id, state, author_id)
  VALUES ($1, $2, $3, 'draft', $4)
  RETURNING ${COLUMNS}`;

const FIND_BY_ID = `SELECT ${COLUMNS} FROM app.announcement WHERE id = $1`;

const LOCK_BY_ID = `SELECT ${COLUMNS} FROM app.announcement WHERE id = $1 FOR UPDATE`;

const LIST = `SELECT ${COLUMNS} FROM app.announcement ORDER BY updated_at DESC, id ASC LIMIT $1 OFFSET $2`;

const COUNT = "SELECT count(*)::int AS total FROM app.announcement";

const UPDATE = `
  UPDATE app.announcement
  SET title = $2, body = $3, movie_id = $4, state = $5, version = version + 1, updated_at = now()
  WHERE id = $1
  RETURNING ${COLUMNS}`;

const PUBLISH = `
  UPDATE app.announcement
  SET title = $2, body = $3, movie_id = $4, state = 'published', published_at = now(), version = version + 1,
      updated_at = now()
  WHERE id = $1
  RETURNING ${COLUMNS}`;

const MARK_DELETED = `
  UPDATE app.announcement SET state = 'deleted', version = version + 1, updated_at = now()
  WHERE id = $1
  RETURNING ${COLUMNS}`;

const MOVIE_EXISTS = "SELECT EXISTS (SELECT 1 FROM app.movie WHERE id = $1) AS present";

interface AnnouncementRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly movie_id: string | null;
  readonly state: AnnouncementState;
  readonly published_at: Date | null;
  readonly author_id: string;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function toRecord(row: AnnouncementRow): AnnouncementRecord {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    movieId: row.movie_id,
    state: row.state,
    publishedAt: row.published_at,
    authorId: row.author_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function onlyRecord(rows: readonly AnnouncementRow[]): AnnouncementRecord {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("locked announcement no longer exists");
  }
  return toRecord(row);
}

export function createAnnouncementRepository(deps: { sql: Sql }): AnnouncementRepository {
  const { sql } = deps;
  const contentParams = (content: AnnouncementContent) => [content.title, content.body, content.movieId];
  return {
    async insertDraft(tx, content, authorId) {
      return onlyRecord(await sql.query<AnnouncementRow>(tx, INSERT_DRAFT, [...contentParams(content), authorId]));
    },
    async findById(tx, announcementId) {
      const row = (await sql.query<AnnouncementRow>(tx, FIND_BY_ID, [announcementId]))[0];
      return row === undefined ? null : toRecord(row);
    },
    async lockById(tx, announcementId) {
      const row = (await sql.query<AnnouncementRow>(tx, LOCK_BY_ID, [announcementId]))[0];
      return row === undefined ? null : toRecord(row);
    },
    async list(tx, limit, offset) {
      return (await sql.query<AnnouncementRow>(tx, LIST, [limit, offset])).map(toRecord);
    },
    async count(tx) {
      return (await sql.query<{ total: number }>(tx, COUNT, []))[0]?.total ?? 0;
    },
    async update(tx, announcementId, content, state) {
      return onlyRecord(await sql.query<AnnouncementRow>(tx, UPDATE, [announcementId, ...contentParams(content), state]));
    },
    async publish(tx, announcementId, content) {
      return onlyRecord(await sql.query<AnnouncementRow>(tx, PUBLISH, [announcementId, ...contentParams(content)]));
    },
    async markDeleted(tx, announcementId) {
      return onlyRecord(await sql.query<AnnouncementRow>(tx, MARK_DELETED, [announcementId]));
    },
    async movieExists(tx, movieId) {
      return (await sql.query<{ present: boolean }>(tx, MOVIE_EXISTS, [movieId]))[0]?.present ?? false;
    },
  };
}
