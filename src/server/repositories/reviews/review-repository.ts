import "server-only";

import type { Sql, SqlParam } from "../../db";
import type { AccountId, ContentRevision, MovieId, ModerationState, MovieUpdateLock, ReviewId, ReviewUpdateLock, RowVersion, Tx } from "../../shared";

export interface ReviewRecord {
  readonly id: ReviewId;
  readonly movieId: MovieId;
  readonly authorId: AccountId;
  readonly authorDisplayName: string;
  readonly rating: number;
  readonly body: string;
  readonly deletedAt: Date | null;
  readonly hiddenAt: Date | null;
  readonly moderationState: ModerationState;
  readonly contentRevision: ContentRevision;
  readonly clearanceSource: "ai" | "admin" | null;
  readonly version: RowVersion;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ReviewRow {
  readonly id: ReviewId;
  readonly movie_id: MovieId;
  readonly author_id: AccountId;
  readonly author_display_name: string;
  readonly rating: number;
  readonly body: string;
  readonly deleted_at: Date | null;
  readonly hidden_at: Date | null;
  readonly moderation_state: ModerationState;
  readonly content_revision: ContentRevision;
  readonly clearance_source: "ai" | "admin" | null;
  readonly version: RowVersion;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface ReviewTransitionRow {
  readonly id: ReviewId;
  readonly version: RowVersion;
  readonly content_revision: ContentRevision;
  readonly moderation_state: ModerationState;
  readonly hidden_at: Date | null;
  readonly deleted_at: Date | null;
}

export interface ReviewScreeningRow {
  readonly id: ReviewId;
  readonly content_revision: ContentRevision;
  readonly version: RowVersion;
  readonly body: string;
  readonly moderation_state: ModerationState;
  readonly hidden_at: Date | null;
  readonly deleted_at: Date | null;
  readonly movie_archived: boolean;
}

export interface ReviewRepository {
  /** Returns a Review with its public author identity, or null when the id is absent. */
  findById(tx: Tx, reviewId: ReviewId): Promise<ReviewRecord | null>;
  /** Finds the author/movie pair under the Review lock taken after the Movie lock. */
  findForWrite(tx: Tx, movieId: MovieId, authorId: AccountId): Promise<ReviewRecord | null>;
  findForAuthorWrite(tx: Tx, reviewId: ReviewId, authorId: AccountId): Promise<ReviewRecord | null>;
  /** Inserts a new pending Review and returns its complete record. */
  insert(tx: Tx, movieId: MovieId, authorId: AccountId, content: ReviewContent): Promise<ReviewRecord>;
  /** Restores an author-deleted, non-hidden Review with a new pending content revision. */
  restoreDeleted(tx: Tx, reviewId: ReviewId, content: ReviewContent): Promise<ReviewRecord>;
  updateRatingOnly(tx: Tx, reviewId: ReviewId, rating: number): Promise<ReviewRecord>;
  updateBody(tx: Tx, reviewId: ReviewId, rating: number, body: string): Promise<ReviewRecord>;
  softDelete(tx: Tx, reviewId: ReviewId): Promise<ReviewRecord>;
  listPublic(tx: Tx, movieId: MovieId, page: number, pageSize: number): Promise<{ readonly items: readonly ReviewRecord[]; readonly total: number } | null>;
  listOwn(tx: Tx, authorId: AccountId, page: number, pageSize: number): Promise<{ readonly items: readonly ReviewRecord[]; readonly total: number }>;
  lockForTransition(tx: Tx, reviewId: ReviewId, movie: MovieUpdateLock): Promise<ReviewTransitionRow | null>;
  lockAllForMovie(tx: Tx, movie: MovieUpdateLock): Promise<void>;
  readForScreening(tx: Tx, reviewId: ReviewId): Promise<ReviewScreeningRow | null>;
  applyAutomatic(tx: Tx, review: ReviewUpdateLock, state: Extract<ModerationState, "cleared" | "flagged">): Promise<ReviewTransitionRow | null>;
  approveAdmin(tx: Tx, review: ReviewUpdateLock): Promise<ReviewTransitionRow | null>;
  hideAdmin(tx: Tx, review: ReviewUpdateLock): Promise<ReviewTransitionRow | null>;
  restoreAdmin(tx: Tx, review: ReviewUpdateLock): Promise<ReviewTransitionRow | null>;
  hideForAcceptedReport(tx: Tx, review: ReviewUpdateLock): Promise<ReviewTransitionRow | null>;
}

export interface ReviewContent {
  readonly rating: number;
  readonly body: string;
}

const FIND_BY_ID = `
  SELECT r.id, r.movie_id, r.author_id, a.display_name AS author_display_name,
         r.rating, r.body, r.deleted_at, r.hidden_at, r.moderation_state,
         r.content_revision, r.clearance_source, r.version, r.created_at, r.updated_at
  FROM app.review r
  JOIN app.account a ON a.id = r.author_id
  WHERE r.id = $1`;

const FIND_FOR_WRITE = `${FIND_BY_ID.replace("WHERE r.id = $1", "WHERE r.movie_id = $1 AND r.author_id = $2 FOR UPDATE")}`;
const FIND_FOR_AUTHOR_WRITE = `${FIND_BY_ID.replace("WHERE r.id = $1", "WHERE r.id = $1 AND r.author_id = $2 FOR UPDATE")}`;

const INSERT = `
  INSERT INTO app.review (movie_id, author_id, rating, body, moderation_state, content_revision, clearance_source)
  VALUES ($1, $2, $3, $4, 'pending', 1, NULL)
  RETURNING id`;

const RESTORE_DELETED = `
  UPDATE app.review
     SET rating = $2, body = $3, deleted_at = NULL, moderation_state = 'pending', clearance_source = NULL,
         content_revision = content_revision + 1, version = version + 1, updated_at = now()
   WHERE id = $1 AND deleted_at IS NOT NULL AND hidden_at IS NULL
   RETURNING id`;

const UPDATE_RATING_ONLY = `
  UPDATE app.review
     SET rating = $2, version = version + 1, updated_at = now()
   WHERE id = $1
   RETURNING id`;

const UPDATE_BODY = `
  UPDATE app.review
     SET rating = $2, body = $3, moderation_state = 'pending', clearance_source = NULL,
         content_revision = content_revision + 1, version = version + 1, updated_at = now()
   WHERE id = $1
   RETURNING id`;

const SOFT_DELETE = `
  UPDATE app.review
     SET deleted_at = now(), version = version + 1, updated_at = now()
   WHERE id = $1 AND deleted_at IS NULL
   RETURNING id`;

const LIST_PUBLIC = `
  SELECT r.id, r.movie_id, r.author_id, a.display_name AS author_display_name,
         r.rating, r.body, r.deleted_at, r.hidden_at, r.moderation_state,
         r.content_revision, r.clearance_source, r.version, r.created_at, r.updated_at
    FROM app.review r JOIN app.account a ON a.id = r.author_id
    JOIN app.movie m ON m.id = r.movie_id
   WHERE r.movie_id = $1 AND m.archived_at IS NULL AND r.deleted_at IS NULL AND r.hidden_at IS NULL AND r.moderation_state = 'cleared'
   ORDER BY r.created_at DESC, r.id ASC LIMIT $2 OFFSET $3`;
const COUNT_PUBLIC = `
  SELECT count(*)::integer AS total FROM app.review r JOIN app.movie m ON m.id = r.movie_id
   WHERE r.movie_id = $1 AND m.archived_at IS NULL AND r.deleted_at IS NULL AND r.hidden_at IS NULL AND r.moderation_state = 'cleared'`;
const ACTIVE_MOVIE = `SELECT 1 FROM app.movie WHERE id = $1 AND archived_at IS NULL`;
const LIST_OWN = `${FIND_BY_ID.replace("WHERE r.id = $1", "WHERE r.author_id = $1 AND r.deleted_at IS NULL AND r.hidden_at IS NULL ORDER BY r.updated_at DESC, r.id ASC LIMIT $2 OFFSET $3")}`;
const COUNT_OWN = `SELECT count(*)::integer AS total FROM app.review WHERE author_id = $1 AND deleted_at IS NULL AND hidden_at IS NULL`;
const LOCK_FOR_TRANSITION = `
  SELECT id, version, content_revision, moderation_state, hidden_at, deleted_at
    FROM app.review
   WHERE id = $1 AND movie_id = $2
   FOR UPDATE`;
const LOCK_ALL_FOR_MOVIE = `
  SELECT id
    FROM app.review
   WHERE movie_id = $1
   ORDER BY id ASC
   FOR UPDATE`;
const READ_FOR_SCREENING = `
  SELECT r.id, r.content_revision, r.version, r.body, r.moderation_state,
         r.hidden_at, r.deleted_at, m.archived_at IS NOT NULL AS movie_archived
    FROM app.review r
    JOIN app.movie m ON m.id = r.movie_id
   WHERE r.id = $1`;
const APPLY_AUTOMATIC = `
  UPDATE app.review
     SET moderation_state = $2, clearance_source = 'ai', version = version + 1, updated_at = now()
   WHERE id = $1
     AND version = $3
     AND content_revision = $4
     AND moderation_state = 'pending'
     AND hidden_at IS NULL
     AND deleted_at IS NULL
   RETURNING id, version, content_revision, moderation_state, hidden_at, deleted_at`;
const APPROVE_ADMIN = `
  UPDATE app.review
     SET moderation_state = 'cleared', clearance_source = 'admin', version = version + 1, updated_at = now()
   WHERE id = $1 AND version = $2
   RETURNING id, version, content_revision, moderation_state, hidden_at, deleted_at`;
const HIDE_ADMIN = `
  UPDATE app.review
     SET hidden_at = now(), version = version + 1, updated_at = now()
   WHERE id = $1 AND version = $2 AND hidden_at IS NULL
   RETURNING id, version, content_revision, moderation_state, hidden_at, deleted_at`;
const RESTORE_ADMIN = `
  UPDATE app.review
     SET hidden_at = NULL, version = version + 1, updated_at = now()
   WHERE id = $1 AND version = $2 AND hidden_at IS NOT NULL
   RETURNING id, version, content_revision, moderation_state, hidden_at, deleted_at`;
const HIDE_ACCEPTED_REPORT = `
  UPDATE app.review
     SET hidden_at = now(), version = version + 1, updated_at = now()
   WHERE id = $1 AND version = $2 AND hidden_at IS NULL
   RETURNING id, version, content_revision, moderation_state, hidden_at, deleted_at`;

function toRecord(row: ReviewRow): ReviewRecord {
  return {
    id: row.id,
    movieId: row.movie_id,
    authorId: row.author_id,
    authorDisplayName: row.author_display_name,
    rating: row.rating,
    body: row.body,
    deletedAt: row.deleted_at,
    hiddenAt: row.hidden_at,
    moderationState: row.moderation_state,
    contentRevision: row.content_revision,
    clearanceSource: row.clearance_source,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createReviewRepository(deps: { readonly sql: Sql }): ReviewRepository {
  return {
    async findById(tx, reviewId) {
      const row = (await deps.sql.query<ReviewRow>(tx, FIND_BY_ID, [reviewId]))[0];
      return row === undefined ? null : toRecord(row);
    },
    async findForWrite(tx, movieId, authorId) {
      const row = (await deps.sql.query<ReviewRow>(tx, FIND_FOR_WRITE, [movieId, authorId]))[0];
      return row === undefined ? null : toRecord(row);
    },
    async findForAuthorWrite(tx, reviewId, authorId) {
      const row = (await deps.sql.query<ReviewRow>(tx, FIND_FOR_AUTHOR_WRITE, [reviewId, authorId]))[0];
      return row === undefined ? null : toRecord(row);
    },
    async insert(tx, movieId, authorId, content) {
      const rows = await deps.sql.query<{ id: ReviewId }>(tx, INSERT, [movieId, authorId, content.rating, content.body]);
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("review insert returned no id");
      const saved = await this.findById(tx, id);
      if (saved === null) throw new Error("inserted review could not be read");
      return saved;
    },
    async restoreDeleted(tx, reviewId, content) {
      const rows = await deps.sql.query<{ id: ReviewId }>(tx, RESTORE_DELETED, [reviewId, content.rating, content.body]);
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("deleted review could not be restored");
      const saved = await this.findById(tx, id);
      if (saved === null) throw new Error("restored review could not be read");
      return saved;
    },
    async updateRatingOnly(tx, reviewId, rating) {
      return readUpdated(deps.sql, tx, UPDATE_RATING_ONLY, [reviewId, rating]);
    },
    async updateBody(tx, reviewId, rating, body) {
      return readUpdated(deps.sql, tx, UPDATE_BODY, [reviewId, rating, body]);
    },
    async softDelete(tx, reviewId) {
      return readUpdated(deps.sql, tx, SOFT_DELETE, [reviewId]);
    },
    async listPublic(tx, movieId, page, pageSize) {
      const activeMovie = await deps.sql.query<{ one: number }>(tx, ACTIVE_MOVIE, [movieId]);
      if (activeMovie.length === 0) return null;
      const [items, count] = await Promise.all([
        deps.sql.query<ReviewRow>(tx, LIST_PUBLIC, [movieId, pageSize, (page - 1) * pageSize]),
        deps.sql.query<{ total: number }>(tx, COUNT_PUBLIC, [movieId]),
      ]);
      return { items: items.map(toRecord), total: count[0]?.total ?? 0 };
    },
    async listOwn(tx, authorId, page, pageSize) {
      const [items, count] = await Promise.all([
        deps.sql.query<ReviewRow>(tx, LIST_OWN, [authorId, pageSize, (page - 1) * pageSize]),
        deps.sql.query<{ total: number }>(tx, COUNT_OWN, [authorId]),
      ]);
      return { items: items.map(toRecord), total: count[0]?.total ?? 0 };
    },
    async lockForTransition(tx, reviewId, movie) {
      const row = (await deps.sql.query<ReviewTransitionRow>(tx, LOCK_FOR_TRANSITION, [reviewId, movie.movieId]))[0];
      return row === undefined ? null : row;
    },
    async lockAllForMovie(tx, movie) {
      await deps.sql.query(tx, LOCK_ALL_FOR_MOVIE, [movie.movieId]);
    },
    async readForScreening(tx, reviewId) {
      const row = (await deps.sql.query<ReviewScreeningRow>(tx, READ_FOR_SCREENING, [reviewId]))[0];
      return row === undefined ? null : row;
    },
    async applyAutomatic(tx, review, state) {
      const row = (
        await deps.sql.query<ReviewTransitionRow>(tx, APPLY_AUTOMATIC, [
          review.reviewId,
          state,
          review.version,
          review.contentRevision,
        ])
      )[0];
      return row === undefined ? null : row;
    },
    async approveAdmin(tx, review) {
      const row = (await deps.sql.query<ReviewTransitionRow>(tx, APPROVE_ADMIN, [review.reviewId, review.version]))[0];
      return row === undefined ? null : row;
    },
    async hideAdmin(tx, review) {
      const row = (await deps.sql.query<ReviewTransitionRow>(tx, HIDE_ADMIN, [review.reviewId, review.version]))[0];
      return row === undefined ? null : row;
    },
    async restoreAdmin(tx, review) {
      const row = (await deps.sql.query<ReviewTransitionRow>(tx, RESTORE_ADMIN, [review.reviewId, review.version]))[0];
      return row === undefined ? null : row;
    },
    async hideForAcceptedReport(tx, review) {
      const row = (await deps.sql.query<ReviewTransitionRow>(tx, HIDE_ACCEPTED_REPORT, [review.reviewId, review.version]))[0];
      return row === undefined ? null : row;
    },
  };
}

async function readUpdated(sql: Sql, tx: Tx, query: string, values: readonly SqlParam[]): Promise<ReviewRecord> {
  const rows = await sql.query<{ id: ReviewId }>(tx, query, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("review update returned no id");
  const row = await sql.query<ReviewRow>(tx, FIND_BY_ID, [id]);
  const saved = row[0];
  if (saved === undefined) throw new Error("updated review could not be read");
  return toRecord(saved);
}
