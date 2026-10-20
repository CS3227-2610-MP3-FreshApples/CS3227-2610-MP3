"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { LiveRegion, StatusBadge, StatusMessage } from "../../../../components/status-primitives";
import { LoadFailure, linkClass, secondaryButtonClass } from "../../_components/admin-feedback";
import { formatUtc } from "../../_lib/admin-http";
import { getMovie, updateMovie } from "../../_lib/movie-client";
import { movieFormFromMovie } from "../../_lib/movie-form";
import { useAdminResource } from "../../_lib/use-admin-resource";
import { MovieForm } from "./movie-form";

type EditMovieProps = Readonly<{ movieId: string }>;

/** FR-05 edit with If-Match. Archived Movies stay editable without being restored (D-79). */
export function EditMovie({ movieId }: EditMovieProps) {
  const load = useCallback(() => getMovie(movieId), [movieId]);
  const { state, reload, replace } = useAdminResource(load);
  const [saved, setSaved] = useState("");
  const [stale, setStale] = useState(false);

  function loadLatest() {
    setStale(false);
    setSaved("");
    reload();
  }

  return (
    <section className="space-y-6">
      <p><Link className={linkClass} href="/admin/movies">Back to movies</Link></p>
      <LiveRegion message={saved} />
      {state.status === "loading" ? <StatusMessage status="info">Loading movie…</StatusMessage> : null}
      {state.status === "error" ? (
        <>
          <h1 className="text-2xl font-semibold">Edit movie</h1>
          <LoadFailure failure={state.failure} onRetry={reload} />
        </>
      ) : null}
      {state.status === "ready" ? (
        <>
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold">Edit “{state.value.title}”</h1>
            <p>
              {state.value.archivedAt === null
                ? <StatusBadge label="Active" tone="success" />
                : <StatusBadge label="Archived" tone="neutral" />}
              {" "}Last updated <time dateTime={state.value.updatedAt}>{formatUtc(state.value.updatedAt)}</time>.
            </p>
            <p>Movie ID (for announcement links): <code>{state.value.id}</code></p>
            {state.value.archivedAt !== null ? (
              <p>Saving changes does not restore this movie. Restore it from the movie list.</p>
            ) : null}
          </header>
          {stale ? (
            <div className="space-y-2">
              <StatusMessage status="warning">
                Your text is still in the form. Copy anything you want to keep before loading the latest version.
              </StatusMessage>
              <button className={secondaryButtonClass} onClick={loadLatest} type="button">Load latest version</button>
            </div>
          ) : null}
          <MovieForm
            initialValues={movieFormFromMovie(state.value)}
            // A saved change has a new version; remounting shows the stored, trimmed values.
            key={state.value.version}
            onSubmit={async (changes) => {
              setSaved("");
              const result = await updateMovie(movieId, state.value.version, changes);
              if (!result.ok) {
                setStale(result.kind === "stale");
                return result;
              }
              setStale(false);
              replace(result.value);
              setSaved(`Saved “${result.value.title}”.`);
              return null;
            }}
            submitLabel="Save changes"
            submittingLabel="Saving…"
          />
        </>
      ) : null}
    </section>
  );
}
