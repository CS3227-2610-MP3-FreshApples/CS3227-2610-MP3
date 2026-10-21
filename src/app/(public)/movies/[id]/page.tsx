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
    <article aria-labelledby="movie-title">
      <h1 id="movie-title">{movie.title}</h1>
      <p>{ratingLabel(movie.averageRating, movie.reviewCount)}</p>
      <p>{movie.synopsis}</p>
      <dl>
        <div><dt>Release date</dt><dd>{movie.releaseDate ?? "Unknown"}</dd></div>
        <div><dt>Genres</dt><dd>{movie.genres.length === 0 ? "None listed" : movie.genres.join(", ")}</dd></div>
        <div><dt>Director</dt><dd>{movie.director || "Not listed"}</dd></div>
        <div><dt>Cast</dt><dd>{movie.cast.length === 0 ? "None listed" : movie.cast.join(", ")}</dd></div>
        <div><dt>Runtime</dt><dd>{movie.runtimeMinutes === null ? "Unknown" : `${movie.runtimeMinutes} minutes`}</dd></div>
      </dl>
      {movie.reviewCount === 0 ? <p role="status">No community ratings yet.</p> : null}
    </article>
  );
}

function ratingLabel(averageRating: number | null, reviewCount: number): string {
  return averageRating === null ? "No community ratings yet." : `${averageRating}/10 from ${reviewCount} reviews`;
}
