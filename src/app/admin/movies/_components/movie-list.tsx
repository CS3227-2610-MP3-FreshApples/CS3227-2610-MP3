"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { ConfirmDialog } from "../../../../components/confirmation-dialog";
import { Pagination } from "../../../../components/pagination";
import { LiveRegion, StatusBadge, StatusMessage } from "../../../../components/status-primitives";
import { DataTable } from "../../../../components/table-state";
import { LoadFailure, linkClass, primaryButtonClass, secondaryButtonClass } from "../../_components/admin-feedback";
import { formatUtc, type AdminResult } from "../../_lib/admin-http";
import { archiveMovie, listMovies, restoreMovie, type AdminMovieView } from "../../_lib/movie-client";
import { useAdminResource } from "../../_lib/use-admin-resource";

type MovieListProps = Readonly<{ page: number }>;

/** FR-05 Movie list: every Movie including archived ones, with archive (confirmed) and restore. */
export function MovieList({ page }: MovieListProps) {
  const load = useCallback(() => listMovies(page), [page]);
  const { state, reload } = useAdminResource(load);
  const [archiveTarget, setArchiveTarget] = useState<AdminMovieView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [actionError, setActionError] = useState("");

  async function act(movie: AdminMovieView, run: () => Promise<AdminResult<unknown>>, done: string) {
    setBusyId(movie.id);
    setActionError("");
    setAnnouncement("");
    try {
      const result = await run();
      if (result.ok) {
        setAnnouncement(done);
      } else {
        setActionError(result.message);
      }
      // Success changes the order; a stale or missing row means the list is out of date.
      if (result.ok || result.kind === "stale" || result.kind === "not_found") reload();
    } finally {
      setBusyId(null);
    }
  }

  function confirmArchive() {
    const movie = archiveTarget;
    setArchiveTarget(null);
    if (movie !== null) void act(movie, () => archiveMovie(movie.id, movie.version), `Archived “${movie.title}”.`);
  }

  function restore(movie: AdminMovieView) {
    void act(movie, () => restoreMovie(movie.id, movie.version), `Restored “${movie.title}”.`);
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Manage movies</h1>
        <p>Archived movies stay here and can be restored. They are hidden from public pages.</p>
        <Link className={primaryButtonClass} href="/admin/movies/new">Create movie</Link>
      </header>

      <LiveRegion message={announcement} />
      {actionError !== "" ? <StatusMessage status="error">{actionError}</StatusMessage> : null}

      {state.status === "loading" ? <StatusMessage status="info">Loading movies…</StatusMessage> : null}
      {state.status === "error" ? <LoadFailure failure={state.failure} onRetry={reload} /> : null}
      {state.status === "ready" ? (
        <>
          <DataTable
            caption="Movies, most recently updated first"
            columns={[
              {
                header: "Title",
                cell: (movie) => <Link className={linkClass} href={`/admin/movies/${movie.id}`}>{movie.title}</Link>,
              },
              {
                header: "Status",
                cell: (movie) => movie.archivedAt === null
                  ? <StatusBadge label="Active" tone="success" />
                  : <StatusBadge label="Archived" tone="neutral" />,
              },
              { header: "Release date", cell: (movie) => movie.releaseDate ?? "—" },
              { header: "Last updated", cell: (movie) => <time dateTime={movie.updatedAt}>{formatUtc(movie.updatedAt)}</time> },
              {
                header: "Actions",
                cell: (movie) => movie.archivedAt === null ? (
                  <button
                    aria-label={`Archive ${movie.title}`}
                    className={secondaryButtonClass}
                    disabled={busyId !== null}
                    onClick={() => setArchiveTarget(movie)}
                    type="button"
                  >
                    {busyId === movie.id ? "Archiving…" : "Archive"}
                  </button>
                ) : (
                  <button
                    aria-label={`Restore ${movie.title}`}
                    className={secondaryButtonClass}
                    disabled={busyId !== null}
                    onClick={() => restore(movie)}
                    type="button"
                  >
                    {busyId === movie.id ? "Restoring…" : "Restore"}
                  </button>
                ),
              },
            ]}
            emptyMessage={state.value.total === 0 ? "No movies yet. Create the first one." : "No movies on this page."}
            rowKey={(movie) => movie.id}
            rows={state.value.items}
          />
          <Pagination
            hrefForPage={(target) => `/admin/movies?page=${target}`}
            page={state.value.page}
            pageSize={state.value.pageSize}
            total={state.value.total}
          />
        </>
      ) : null}

      <ConfirmDialog
        confirmLabel="Archive movie"
        consequence="The movie is removed from public results until you restore it. Its reviews and other records are kept."
        dialogId="archive-movie-dialog"
        onCancel={() => setArchiveTarget(null)}
        onConfirm={confirmArchive}
        open={archiveTarget !== null}
        targetName={archiveTarget?.title ?? ""}
        title="Archive movie"
      />
    </section>
  );
}
