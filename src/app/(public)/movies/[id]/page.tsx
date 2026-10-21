import Link from "next/link";
import { notFound } from "next/navigation";

import { PublicReadUnavailable } from "../../../../components/public-read-unavailable";
import { publicCatalogueReadService } from "../../../../server/composition";
import { parseId } from "../../../../server/http";

type MovieDetailsPageProps = Readonly<{
  params: Promise<{ readonly id: string }>;
}>;

export default async function MovieDetailsPage({ params }: MovieDetailsPageProps) {
  const movieId = parseId<"MovieId">((await params).id);
  if (!movieId.ok) notFound();
  if (publicCatalogueReadService === null) {
    return <PublicReadUnavailable title="Movie details" titleId="movie-title" />;
  }

  const movie = await publicCatalogueReadService.getMovie(movieId.value);
  if (movie === null) notFound();

  return (
    <article className="max-w-4xl space-y-8" aria-labelledby="movie-title">
      <Link className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline underline-offset-4 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/movies">← Back to movies</Link>
      <header className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">Movie details</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl" id="movie-title">{movie.title}</h1>
        <p className="text-lg font-semibold text-blue-800">{ratingLabel(movie.averageRating, movie.reviewCount)}</p>
        <p className="max-w-3xl text-lg leading-8 text-slate-700">{movie.synopsis}</p>
      </header>
      <section className="space-y-4" aria-labelledby="movie-information-title">
        <h2 className="text-xl font-semibold text-slate-950" id="movie-information-title">Movie information</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4"><dt className="text-sm font-semibold text-slate-600">Release date</dt><dd className="mt-1 text-slate-950">{movie.releaseDate ?? "Unknown"}</dd></div>
          <div className="rounded-lg border border-slate-200 bg-white p-4"><dt className="text-sm font-semibold text-slate-600">Genres</dt><dd className="mt-1 text-slate-950">{movie.genres.length === 0 ? "None listed" : movie.genres.join(", ")}</dd></div>
          <div className="rounded-lg border border-slate-200 bg-white p-4"><dt className="text-sm font-semibold text-slate-600">Director</dt><dd className="mt-1 text-slate-950">{movie.director || "Not listed"}</dd></div>
          <div className="rounded-lg border border-slate-200 bg-white p-4"><dt className="text-sm font-semibold text-slate-600">Cast</dt><dd className="mt-1 text-slate-950">{movie.cast.length === 0 ? "None listed" : movie.cast.join(", ")}</dd></div>
          <div className="rounded-lg border border-slate-200 bg-white p-4"><dt className="text-sm font-semibold text-slate-600">Runtime</dt><dd className="mt-1 text-slate-950">{movie.runtimeMinutes === null ? "Unknown" : `${movie.runtimeMinutes} minutes`}</dd></div>
        </dl>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="community-reviews-title">
        <h2 className="text-xl font-semibold text-slate-950" id="community-reviews-title">Community reviews</h2>
        {movie.reviewCount === 0 ? <p className="mt-3 text-slate-600" role="status">No community ratings yet.</p> : <p className="mt-3 text-slate-600">Reviews will appear here once the public review listing is available.</p>}
      </section>
    </article>
  );
}

function ratingLabel(averageRating: number | null, reviewCount: number): string {
  return averageRating === null ? "No community ratings yet." : `${averageRating}/10 from ${reviewCount} reviews`;
}
