import {
  adminRead,
  adminWrite,
  isListPage,
  isRecord,
  jsonBody,
  noContentVersion,
  pageQuery,
  type AdminResult,
  type Fetcher,
  type ListPage,
} from "./admin-http";

/** The Admin Movie projection (api.md 8.1), declared here because Client Components never import src/server. */
export type AdminMovieView = Readonly<{
  id: string;
  title: string;
  synopsis: string;
  releaseDate: string | null;
  genres: readonly string[];
  director: string;
  cast: readonly string[];
  runtimeMinutes: number | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

/** The writable Movie fields (D-80). */
export type MovieWrite = Readonly<{
  title: string;
  synopsis: string;
  releaseDate: string | null;
  genres: readonly string[];
  director: string;
  cast: readonly string[];
  runtimeMinutes: number | null;
}>;

const BASE = "/api/v1/admin/movies";

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isAdminMovie(value: unknown): value is AdminMovieView {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.synopsis === "string"
    && (value.releaseDate === null || typeof value.releaseDate === "string")
    && isStringList(value.genres)
    && typeof value.director === "string"
    && isStringList(value.cast)
    && (value.runtimeMinutes === null || Number.isInteger(value.runtimeMinutes))
    && (value.archivedAt === null || typeof value.archivedAt === "string")
    && Number.isInteger(value.version)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}

function isMoviePage(value: unknown): value is ListPage<AdminMovieView> {
  return isListPage(value, isAdminMovie);
}

function moviePath(movieId: string): string {
  return `${BASE}/${encodeURIComponent(movieId)}`;
}

export function listMovies(page: number, fetcher: Fetcher = fetch): Promise<AdminResult<ListPage<AdminMovieView>>> {
  return adminRead(`${BASE}?${pageQuery(page)}`, isMoviePage, fetcher);
}

export function getMovie(movieId: string, fetcher: Fetcher = fetch): Promise<AdminResult<AdminMovieView>> {
  return adminRead(moviePath(movieId), isAdminMovie, fetcher);
}

export function createMovie(input: MovieWrite, fetcher: Fetcher = fetch): Promise<AdminResult<AdminMovieView>> {
  return adminWrite({ path: BASE, method: "POST", body: input }, jsonBody(isAdminMovie), fetcher);
}

export function updateMovie(
  movieId: string,
  version: number,
  changes: Partial<MovieWrite>,
  fetcher: Fetcher = fetch,
): Promise<AdminResult<AdminMovieView>> {
  return adminWrite({ path: moviePath(movieId), method: "PATCH", body: changes, version }, jsonBody(isAdminMovie), fetcher);
}

/** Archive (DELETE); the result is the Movie's resulting version (D-79, D-81). */
export function archiveMovie(movieId: string, version: number, fetcher: Fetcher = fetch): Promise<AdminResult<number>> {
  return adminWrite({ path: moviePath(movieId), method: "DELETE", version }, noContentVersion, fetcher);
}

export function restoreMovie(movieId: string, version: number, fetcher: Fetcher = fetch): Promise<AdminResult<AdminMovieView>> {
  return adminWrite({ path: `${moviePath(movieId)}/restore`, method: "POST", version }, jsonBody(isAdminMovie), fetcher);
}
