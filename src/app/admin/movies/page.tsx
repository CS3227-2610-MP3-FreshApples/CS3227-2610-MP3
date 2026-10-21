import { Suspense } from "react";

import { StatusMessage } from "../../../components/status-primitives";
import { pageFromSearchParam } from "../_lib/admin-http";
import { MovieList } from "./_components/movie-list";

type AdminMoviesPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// Data loads in the browser through the guarded HTTP API; this Server Component reads no Admin data.
// searchParams resolves inside Suspense so the shell still prerenders (cacheComponents).
export default function AdminMoviesPage({ searchParams }: AdminMoviesPageProps) {
  return (
    <Suspense fallback={<StatusMessage status="info">Loading movies…</StatusMessage>}>
      {searchParams.then((query) => <MovieList page={pageFromSearchParam(query.page)} />)}
    </Suspense>
  );
}
