"use client";

import Link from "next/link";
import { useState } from "react";

import { LiveRegion } from "../../../../components/status-primitives";
import { linkClass } from "../../_components/admin-feedback";
import { createMovie, type AdminMovieView } from "../../_lib/movie-client";
import { EMPTY_MOVIE_FORM } from "../../_lib/movie-form";
import { MovieForm } from "./movie-form";

/** FR-05 create. On success the form is replaced by links, so a second click cannot create a duplicate. */
export function CreateMovie() {
  const [created, setCreated] = useState<AdminMovieView | null>(null);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Create movie</h1>
      <LiveRegion message={created === null ? "" : `Created “${created.title}”.`} />
      {created === null ? (
        <MovieForm
          initialValues={EMPTY_MOVIE_FORM}
          onSubmit={async (movie) => {
            const result = await createMovie(movie);
            if (!result.ok) return result;
            setCreated(result.value);
            return null;
          }}
          submitLabel="Create movie"
          submittingLabel="Creating…"
        />
      ) : (
        <p>
          <Link className={linkClass} href={`/admin/movies/${created.id}`}>Edit “{created.title}”</Link>
          {" or "}<Link className={linkClass} href="/admin/movies">return to the movie list</Link>.
        </p>
      )}
    </section>
  );
}
