import "server-only";

import type { Database } from "../../db";
import type {
  ActiveMovieDetailRecord,
  ActiveMovieSummaryRecord,
  PublicMovieReadRepository,
  PublicMovieSort,
} from "../../repositories/catalogue";
import type { FieldErrors, MovieId, Result } from "../../shared";

export const MOVIE_LIST_ORDER = {
  release_desc: [
    { field: "releaseDate", direction: "desc", nulls: "last" },
    { field: "id", direction: "asc" },
  ],
  title_asc: [
    { field: "title", direction: "asc", caseInsensitive: true },
    { field: "id", direction: "asc" },
  ],
} as const;

export interface PublicMovieListQueryInput {
  readonly q?: unknown;
  readonly sort: unknown;
  /** Already validated by the shared HTTP pagination contract. */
  readonly page: number;
  /** Already validated by the shared HTTP pagination contract. */
  readonly pageSize: number;
}

export interface PublicMovieListQuery {
  readonly q: string | null;
  readonly sort: PublicMovieSort;
  readonly page: number;
  readonly pageSize: number;
}

export interface PublicMovieSummary {
  readonly id: MovieId;
  readonly title: string;
  readonly releaseYear: number | null;
  readonly genres: readonly string[];
  readonly averageRating: number | null;
  readonly reviewCount: number;
}

export interface PublicMovieDetail {
  readonly id: MovieId;
  readonly title: string;
  readonly synopsis: string;
  readonly releaseDate: string | null;
  readonly genres: readonly string[];
  readonly director: string;
  readonly cast: readonly string[];
  readonly runtimeMinutes: number | null;
  readonly averageRating: number | null;
  readonly reviewCount: number;
}

export interface PublicMovieList {
  readonly items: readonly PublicMovieSummary[];
  readonly total: number;
}

/** Server-side U-01 read boundary shared by public pages and Route Handlers. */
export interface PublicCatalogueReadService {
  listMovies(query: PublicMovieListQuery): Promise<PublicMovieList>;
  /** Null means the Movie is missing or archived and maps to the same public 404. */
  getMovie(movieId: MovieId): Promise<PublicMovieDetail | null>;
}

export function createPublicCatalogueReadService(deps: {
  readonly database: Database;
  readonly movies: PublicMovieReadRepository;
}): PublicCatalogueReadService {
  return {
    async listMovies(query) {
      const page = await deps.database.withTransaction((tx) =>
        deps.movies.listActive(tx, {
          titleQuery: query.q,
          sort: query.sort,
          page: query.page,
          pageSize: query.pageSize,
        }),
      );
      return { items: page.items.map(projectPublicMovieSummary), total: page.total };
    },
    async getMovie(movieId) {
      const movie = await deps.database.withTransaction((tx) => deps.movies.findActiveById(tx, movieId));
      return movie === null ? null : projectPublicMovieDetail(movie);
    },
  };
}

export function normalizePublicMovieListQuery(
  input: PublicMovieListQueryInput,
): Result<PublicMovieListQuery, FieldErrors> {
  const fieldErrors: Record<string, readonly string[]> = {};
  let q: string | null = null;

  if (input.q !== undefined && input.q !== null) {
    if (typeof input.q !== "string") {
      fieldErrors.q = ["invalid value"];
    } else {
      const trimmed = input.q.trim();
      if (Array.from(trimmed).length > 200) {
        fieldErrors.q = ["must be at most 200 characters"];
      } else if (trimmed.length > 0) {
        q = trimmed;
      }
    }
  }

  if (input.sort !== "release_desc" && input.sort !== "title_asc") {
    fieldErrors.sort = ["must be release_desc or title_asc"];
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: fieldErrors };
  }

  return {
    ok: true,
    value: { q, sort: input.sort as PublicMovieSort, page: input.page, pageSize: input.pageSize },
  };
}

export function projectPublicMovieSummary(record: ActiveMovieSummaryRecord): PublicMovieSummary {
  return {
    id: record.id,
    title: record.title,
    releaseYear: record.releaseDate === null ? null : Number(record.releaseDate.slice(0, 4)),
    genres: [...record.genres],
    averageRating: record.averageRating,
    reviewCount: record.reviewCount,
  };
}

export function projectPublicMovieDetail(record: ActiveMovieDetailRecord): PublicMovieDetail {
  return {
    id: record.id,
    title: record.title,
    synopsis: record.synopsis,
    releaseDate: record.releaseDate,
    genres: [...record.genres],
    director: record.director,
    cast: [...record.cast],
    runtimeMinutes: record.runtimeMinutes,
    averageRating: record.averageRating,
    reviewCount: record.reviewCount,
  };
}
