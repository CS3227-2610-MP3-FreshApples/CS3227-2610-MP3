import Link from "next/link";

import { Pagination } from "../../../components/pagination";
import { PublicReadUnavailable } from "../../../components/public-read-unavailable";
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
  const result = publicCatalogueReadService === null ? null : await publicCatalogueReadService.listMovies(query.value);

  return (
    <section className="space-y-8" aria-labelledby="movies-title">
      <header className="max-w-3xl space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">Explore the catalogue</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl" id="movies-title">Movies</h1>
        <p className="text-lg leading-8 text-slate-600">Search the catalogue by title, then open a movie to read its community ratings and reviews.</p>
      </header>
      <form className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-end" action="/movies" method="get">
        <div className="space-y-2">
          <label htmlFor="movie-search">Search by title</label>
          <input className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm focus:border-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" defaultValue={query.value.q ?? ""} id="movie-search" name="q" type="search" />
        </div>
        <div className="space-y-2">
          <label htmlFor="movie-sort">Sort movies</label>
          <select className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm focus:border-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" defaultValue={query.value.sort} id="movie-sort" name="sort">
            <option value="release_desc">Newest release</option>
            <option value="title_asc">Title A–Z</option>
          </select>
        </div>
        <button className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-700 px-5 py-2.5 font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" type="submit">Search</button>
      </form>

      {result === null ? <PublicReadUnavailable title="Movies" titleId="movies-unavailable-title" /> : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-600" role="status">{result.total} movie{result.total === 1 ? "" : "s"} found.</p>
        {query.value.q ? <Link className="text-sm font-semibold text-blue-700 underline underline-offset-4 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/movies">Clear search</Link> : null}
      </div>
      {result.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-semibold text-slate-950">{query.value.q ? `No movies match “${query.value.q}”.` : "No movies are available yet."}</p>
          {query.value.q ? <Link className="mt-3 inline-flex font-semibold text-blue-700 underline underline-offset-4" href="/movies">Clear search</Link> : null}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {result.items.map((movie) => (
            <li key={movie.id}>
              <article className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
                <div className="space-y-3">
                  <h2 className="text-xl font-semibold tracking-tight"><Link className="text-slate-950 underline decoration-slate-300 underline-offset-4 hover:text-blue-700 hover:decoration-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href={`/movies/${movie.id}`}>{movie.title}</Link></h2>
                  <p className="text-sm text-slate-600">{movie.releaseYear === null ? "Release year unknown" : `Released ${movie.releaseYear}`}</p>
                  <p className="text-sm text-slate-600">{movie.genres.length === 0 ? "No genres listed" : movie.genres.join(", ")}</p>
                </div>
                <p className="mt-6 text-sm font-semibold text-blue-800">{ratingLabel(movie.averageRating, movie.reviewCount)}</p>
              </article>
            </li>
          ))}
        </ul>
      )}
      <Pagination hrefForPage={(page) => moviePageHref(page, query.value.q, query.value.sort)} page={query.value.page} pageSize={PAGE_SIZE} total={result.total} />
      </>}
    </section>
  );
}

function InvalidMovieSearch() {
  return (
    <section className="space-y-6" aria-labelledby="movies-title">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950" id="movies-title">Movies</h1>
        <p className="max-w-2xl text-slate-600">Search the catalogue by title, then open a movie to read its community ratings and reviews.</p>
      </header>
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800" role="alert">Use a title search of up to 200 characters and choose a supported sort order.</div>
    </section>
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
