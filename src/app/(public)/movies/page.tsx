import Link from "next/link";

import { publicCatalogueReadService } from "../../../server/composition";
import { normalizePublicMovieListQuery } from "../../../server/services/catalogue";

type MoviesPageProps = Readonly<{
  searchParams: Promise<{
    readonly q?: string | readonly string[];
    readonly sort?: string | readonly string[];
    readonly page?: string | readonly string[];
  }>;
}>;

const PAGE_SIZE = 20;

export default async function MoviesPage({ searchParams }: MoviesPageProps) {
  const params = await searchParams;
  const page = readPage(params.page);
  const q = readSingleValue(params.q);
  const sort = readSingleValue(params.sort) ?? "release_desc";
  const query = normalizePublicMovieListQuery({ q, sort, page, pageSize: PAGE_SIZE });

  if (!query.ok) {
    return <InvalidMovieSearch />;
  }
  if (publicCatalogueReadService === null) {
    throw new Error("Public catalogue read service is unavailable.");
  }

  const result = await publicCatalogueReadService.listMovies(query.value);

  return (
    <section aria-labelledby="movies-title">
      <h1 id="movies-title">Movies</h1>
      <form action="/movies" method="get">
        <label htmlFor="movie-search">Search by title</label>
        <input defaultValue={query.value.q ?? ""} id="movie-search" name="q" type="search" />
        <label htmlFor="movie-sort">Sort movies</label>
        <select defaultValue={query.value.sort} id="movie-sort" name="sort">
          <option value="release_desc">Newest release</option>
          <option value="title_asc">Title A–Z</option>
        </select>
        <button type="submit">Search</button>
      </form>

      <p role="status">{result.total} movie{result.total === 1 ? "" : "s"} found.</p>
      {result.items.length === 0 ? (
        <p>No movies match your search.</p>
      ) : (
        <ul>
          {result.items.map((movie) => (
            <li key={movie.id}>
              <article>
                <h2><Link href={`/movies/${movie.id}`}>{movie.title}</Link></h2>
                <p>{movie.releaseYear === null ? "Release year unknown" : `Released ${movie.releaseYear}`}</p>
                <p>{movie.genres.length === 0 ? "No genres listed" : movie.genres.join(", ")}</p>
                <p>{ratingLabel(movie.averageRating, movie.reviewCount)}</p>
              </article>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={query.value.page} total={result.total} q={query.value.q} sort={query.value.sort} />
    </section>
  );
}

function InvalidMovieSearch() {
  return (
    <section aria-labelledby="movies-title">
      <h1 id="movies-title">Movies</h1>
      <p role="alert">Use a title search of up to 200 characters and choose a supported sort order.</p>
    </section>
  );
}

function Pagination({ page, q, sort, total }: Readonly<{
  page: number;
  q: string | null;
  sort: "release_desc" | "title_asc";
  total: number;
}>) {
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (lastPage === 1) return null;

  return (
    <nav aria-label="Movie pages">
      {page > 1 ? <Link href={moviePageHref(page - 1, q, sort)}>Previous</Link> : null}
      <span> Page {page} of {lastPage} </span>
      {page < lastPage ? <Link href={moviePageHref(page + 1, q, sort)}>Next</Link> : null}
    </nav>
  );
}

function moviePageHref(page: number, q: string | null, sort: "release_desc" | "title_asc"): string {
  const params = new URLSearchParams({ page: String(page), sort });
  if (q !== null) params.set("q", q);
  return `/movies?${params.toString()}`;
}

function readSingleValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readPage(value: string | readonly string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function ratingLabel(averageRating: number | null, reviewCount: number): string {
  return averageRating === null ? "No community ratings yet." : `${averageRating}/10 from ${reviewCount} reviews`;
}
