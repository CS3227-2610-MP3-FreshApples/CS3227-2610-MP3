"use client";

import Link from "next/link";
import { useCallback } from "react";
import { FormField } from "../../../../components/form-primitives";
import { Pagination } from "../../../../components/pagination";
import { LiveRegion, StatusMessage } from "../../../../components/status-primitives";
import { DataTable } from "../../../../components/table-state";
import { linkClass, primaryButtonClass } from "../../_components/admin-feedback";
import { formatUtc } from "../../_lib/admin-http";
import { listReviews, REVIEW_FILTER_OPTIONS, reviewQueueHref, type ReviewFilters } from "../../_lib/review-client";
import { useAdminResource } from "../../_lib/use-admin-resource";
import { ReviewState } from "./review-state";

export function ReviewList({ page, movieId, assessment }: ReviewFilters & Readonly<{ page: number }>) {
  const load = useCallback(() => listReviews(page, { movieId, assessment }), [page, movieId, assessment]);
  const { state } = useAdminResource(load);
  const errors = state.status === "error" ? state.failure.fieldErrors : undefined;
  return <section className="space-y-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">Review moderation</h1>
      <p>Read reviews and automatic assessments, then make a human moderation decision.</p>
    </header>
    <form action="/admin/reviews" method="get" className="grid items-end gap-4 md:grid-cols-3">
      <FormField label="Assessment or state" name="assessment" error={errors?.assessment?.join(" ")}>
        <select defaultValue={assessment}>
          {!REVIEW_FILTER_OPTIONS.some(([value]) => value === assessment) ? <option value={assessment}>Unknown filter</option> : null}
          {REVIEW_FILTER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </FormField>
      <FormField label="Movie ID" name="movieId" error={errors?.movieId?.join(" ")}
        hint="Optional. You can also choose ‘Reviews for this Movie’ in the list.">
        <input defaultValue={movieId} type="text" />
      </FormField>
      <div className="flex flex-wrap items-center gap-4">
        <button className={primaryButtonClass} type="submit">Apply filters</button>
        <Link className={linkClass} href="/admin/reviews">All reviews</Link>
      </div>
    </form>
    <LiveRegion message={state.status === "ready" ? `${state.value.total} reviews found. Page ${state.value.page}.` : ""} />
    {state.status === "loading" ? <StatusMessage status="info">Loading reviews…</StatusMessage> : null}
    {state.status === "error" ? <>
      <StatusMessage status="error">{state.failure.message}</StatusMessage>
      {state.failure.kind === "unauthenticated" ? <Link className={linkClass} href="/sign-in">Sign in</Link> : null}
    </> : null}
    {state.status === "ready" ? <>
      <DataTable caption="Reviews, most recently updated first" rows={state.value.items} rowKey={(review) => review.id}
        emptyMessage={state.value.total === 0 ? "No reviews match these filters. Choose All reviews to clear them." : "No reviews on this page. Choose All reviews to return to the beginning."}
        columns={[
          { header: "Author", cell: (review) => <Link className={linkClass} href={`/admin/reviews/${encodeURIComponent(review.id)}`}>Review by {review.authorDisplayName}</Link> },
          { header: "Movie", cell: (review) => <div className="space-y-2"><p>{review.movieTitle}</p><Link className={linkClass}
            href={reviewQueueHref(1, { movieId: review.movieId, assessment })}>Reviews for this Movie</Link></div> },
          { header: "Status", cell: (review) => <ReviewState review={review} /> },
          { header: "Last updated", cell: (review) => <time dateTime={review.updatedAt}>{formatUtc(review.updatedAt)}</time> },
        ]} />
      <Pagination page={state.value.page} pageSize={state.value.pageSize} total={state.value.total}
        hrefForPage={(target) => reviewQueueHref(target, { movieId, assessment })} />
    </> : null}
  </section>;
}
