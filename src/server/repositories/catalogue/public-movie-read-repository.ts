import "server-only";

import type { Sql } from "../../db";
import type { MovieId, Tx } from "../../shared";

export type PublicMovieSort = "release_desc" | "title_asc";

export interface ActiveMovieListCriteria {
  readonly titleQuery: string | null;
  readonly sort: PublicMovieSort;
  readonly page: number;
  readonly pageSize: number;
}

export interface ActiveMovieSummaryRecord {
  readonly id: MovieId;
  readonly title: string;
  /** PostgreSQL calendar date in YYYY-MM-DD form; null means unknown. */
  readonly releaseDate: string | null;
  readonly genres: readonly string[];
  readonly averageRating: number | null;
  readonly reviewCount: number;
}

export interface ActiveMovieDetailRecord extends ActiveMovieSummaryRecord {
  readonly synopsis: string;
  readonly director: string;
  readonly cast: readonly string[];
  readonly runtimeMinutes: number | null;
}

export interface ActiveMoviePage {
  readonly items: readonly ActiveMovieSummaryRecord[];
  readonly total: number;
}

/** Read-only storage boundary for U-01 public catalogue data. */
export interface PublicMovieReadRepository {
  /** Returns active Movies only, with aggregate values computed from eligible visible Reviews only. */
  listActive(tx: Tx, criteria: ActiveMovieListCriteria): Promise<ActiveMoviePage>;
  /** Returns null for a missing or archived Movie. Never includes a visible-review listing (D-79). */
  findActiveById(tx: Tx, movieId: MovieId): Promise<ActiveMovieDetailRecord | null>;
}

interface MovieSummaryRow {
  readonly id: MovieId;
  readonly title: string;
  readonly release_date: string | null;
  readonly genres: string[];
  readonly average_rating: number | null;
  readonly review_count: number;
}

interface MovieDetailRow extends MovieSummaryRow {
  readonly synopsis: string;
  readonly director: string;
  readonly cast: string[];
  readonly runtime_minutes: number | null;
}

const ACTIVE_FILTER = `
  m.archived_at IS NULL
  AND ($1::text IS NULL OR strpos(lower(m.title), lower($1)) > 0)`;

const COUNT_ACTIVE = `
  SELECT count(*)::integer AS total
  FROM app.movie m
  WHERE ${ACTIVE_FILTER}`;

const SUMMARY_SELECT = `
  SELECT m.id, m.title, m.release_date, m.genres,
         avg(r.rating)::double precision AS average_rating,
         count(r.id)::integer AS review_count
  FROM app.movie m
  LEFT JOIN app.review r
    ON r.movie_id = m.id
   AND r.deleted_at IS NULL
   AND r.hidden_at IS NULL
   AND r.moderation_state = 'cleared'
  WHERE ${ACTIVE_FILTER}
  GROUP BY m.id, m.title, m.release_date, m.genres`;

const LIST_RELEASE_DESC = `${SUMMARY_SELECT}
  ORDER BY m.release_date DESC NULLS LAST, m.id ASC
  LIMIT $2 OFFSET $3`;

const LIST_TITLE_ASC = `${SUMMARY_SELECT}
  ORDER BY lower(m.title) ASC, m.id ASC
  LIMIT $2 OFFSET $3`;

const FIND_ACTIVE_BY_ID = `
  SELECT m.id, m.title, m.synopsis, m.release_date, m.genres, m.director, m."cast", m.runtime_minutes,
         avg(r.rating)::double precision AS average_rating,
         count(r.id)::integer AS review_count
  FROM app.movie m
  LEFT JOIN app.review r
    ON r.movie_id = m.id
   AND r.deleted_at IS NULL
   AND r.hidden_at IS NULL
   AND r.moderation_state = 'cleared'
  WHERE m.id = $1 AND m.archived_at IS NULL
  GROUP BY m.id, m.title, m.synopsis, m.release_date, m.genres, m.director, m."cast", m.runtime_minutes`;

function summary(row: MovieSummaryRow): ActiveMovieSummaryRecord {
  return {
    id: row.id,
    title: row.title,
    releaseDate: row.release_date,
    genres: row.genres,
    averageRating: row.average_rating,
    reviewCount: row.review_count,
  };
}

export function createPublicMovieReadRepository(deps: { readonly sql: Sql }): PublicMovieReadRepository {
  return {
    async listActive(tx, criteria) {
      const countRows = await deps.sql.query<{ total: number }>(tx, COUNT_ACTIVE, [criteria.titleQuery]);
      const offset = (criteria.page - 1) * criteria.pageSize;
      const text = criteria.sort === "release_desc" ? LIST_RELEASE_DESC : LIST_TITLE_ASC;
      const rows = await deps.sql.query<MovieSummaryRow>(tx, text, [criteria.titleQuery, criteria.pageSize, offset]);
      return { items: rows.map(summary), total: countRows[0]?.total ?? 0 };
    },
    async findActiveById(tx, movieId) {
      const rows = await deps.sql.query<MovieDetailRow>(tx, FIND_ACTIVE_BY_ID, [movieId]);
      const row = rows[0];
      return row === undefined
        ? null
        : {
            ...summary(row),
            synopsis: row.synopsis,
            director: row.director,
            cast: row.cast,
            runtimeMinutes: row.runtime_minutes,
          };
    },
  };
}
