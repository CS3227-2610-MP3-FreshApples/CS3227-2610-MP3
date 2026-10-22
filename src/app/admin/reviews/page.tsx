import { Suspense } from "react";
import { StatusMessage } from "../../../components/status-primitives";
import { pageFromSearchParam } from "../_lib/admin-http";
import { ReviewList } from "./_components/review-list";

export default function AdminReviewsPage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  return <Suspense fallback={<StatusMessage status="info">Loading reviews…</StatusMessage>}>
    {searchParams.then((query) => {
      const movieId = typeof query.movieId === "string" ? query.movieId : "";
      const raw = typeof query.assessment === "string" ? query.assessment : "all";
      const assessment = raw === "needs-manual-review" ? "needs_manual_review" : raw;
      const page = pageFromSearchParam(query.page);
      return <ReviewList key={`${page}:${movieId}:${assessment}`} page={page} movieId={movieId} assessment={assessment} />;
    })}
  </Suspense>;
}
