import type { FieldErrors } from "./admin-http";
import type { AdminMovieView, MovieWrite } from "./movie-client";

// The Movie form holds raw text so nothing the Admin typed is lost after a recoverable error. The server
// remains the validator (D-80); this module only converts text to the API's types.

export type MovieFormValues = Readonly<{
  title: string;
  synopsis: string;
  releaseDate: string;
  genres: string;
  director: string;
  cast: string;
  runtimeMinutes: string;
}>;

export type MovieFormField = keyof MovieFormValues;

export const EMPTY_MOVIE_FORM: MovieFormValues = {
  title: "",
  synopsis: "",
  releaseDate: "",
  genres: "",
  director: "",
  cast: "",
  runtimeMinutes: "",
};

export function movieFormFromMovie(movie: AdminMovieView): MovieFormValues {
  return {
    title: movie.title,
    synopsis: movie.synopsis,
    releaseDate: movie.releaseDate ?? "",
    genres: movie.genres.join("\n"),
    director: movie.director,
    cast: movie.cast.join("\n"),
    runtimeMinutes: movie.runtimeMinutes === null ? "" : String(movie.runtimeMinutes),
  };
}

/** One entry per line; blank lines are ignored and order is kept (D-80 keeps list order). */
function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

export type MovieFormConversion = Readonly<{ ok: true; value: MovieWrite }> | Readonly<{ ok: false; fieldErrors: FieldErrors }>;

export function movieWriteFromForm(values: MovieFormValues): MovieFormConversion {
  const runtime = values.runtimeMinutes.trim();
  if (runtime !== "" && !/^\d+$/.test(runtime)) {
    return { ok: false, fieldErrors: { runtimeMinutes: ["Enter a whole number of minutes, or leave it empty."] } };
  }
  return {
    ok: true,
    value: {
      title: values.title,
      synopsis: values.synopsis,
      releaseDate: values.releaseDate.trim() === "" ? null : values.releaseDate.trim(),
      genres: lines(values.genres),
      director: values.director,
      cast: lines(values.cast),
      runtimeMinutes: runtime === "" ? null : Number(runtime),
    },
  };
}
