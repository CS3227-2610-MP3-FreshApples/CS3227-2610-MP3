import { Suspense } from "react";

import { StatusMessage } from "../../../../components/status-primitives";
import { EditMovie } from "../_components/edit-movie";

type AdminEditMoviePageProps = Readonly<{
  params: Promise<{ id: string }>;
}>;

// The Movie loads in the browser through the guarded HTTP API; a malformed id is the API's 404.
// params resolves inside Suspense so the shell still prerenders (cacheComponents).
export default function AdminEditMoviePage({ params }: AdminEditMoviePageProps) {
  return (
    <Suspense fallback={<StatusMessage status="info">Loading movie…</StatusMessage>}>
      {params.then(({ id }) => <EditMovie movieId={id} />)}
    </Suspense>
  );
}
