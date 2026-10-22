"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Pagination } from "../../../../components/pagination";
import { StatusBadge, StatusMessage } from "../../../../components/status-primitives";
import { DataTable } from "../../../../components/table-state";
import { UserRetryButton } from "../../_components/user-ui";
import { formatReviewDate, listOwnReviews, type ReviewFailure, type ReviewPage } from "../_lib/review-client";

type ReviewListState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; failure: ReviewFailure }>
  | Readonly<{ status: "ready"; value: ReviewPage }>;

type ReviewListProps = Readonly<{ page: number }>;

function stateLabel(state: ReviewPage["items"][number]["moderationState"]): { label: string; tone: "success" | "warning" } {
  if (state === "cleared") return { label: "Published", tone: "success" };
  if (state === "flagged") return { label: "Held for review", tone: "warning" };
  return { label: "Pending moderation", tone: "warning" };
}

export function ReviewStatus({ state }: Readonly<{ state: ReviewPage["items"][number]["moderationState"] }>) {
  const status = stateLabel(state);
  return <span aria-label="Review status"><StatusBadge label={status.label} tone={status.tone} /></span>;
}

export function ReviewList({ page }: ReviewListProps) {
  const [state, setState] = useState<ReviewListState>({ status: "loading" });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => {
    setState({ status: "loading" });
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let current = true;
    void listOwnReviews(page).then((result) => {
      if (!current) return;
      setState(result.ok ? { status: "ready", value: result.value } : { status: "error", failure: result });
    });
    return () => { current = false; };
  }, [generation, page]);

  if (state.status === "loading") return <section aria-label="Review status"><StatusMessage status="info">Loading reviews…</StatusMessage></section>;
  if (state.status === "error") {
    return (
      <section className="space-y-4" aria-label="Review status">
        <StatusMessage status="error">{state.failure.message}</StatusMessage>
        <UserRetryButton onClick={reload} />
      </section>
    );
  }

  return (
    <section className="space-y-6" aria-label="Review status">
      <DataTable
        caption="Your reviews"
        columns={[
          { header: "Movie", cell: (review) => <Link className="font-semibold text-blue-800 underline" href={`/movies/${review.movieId}`}>View movie</Link> },
          { header: "Review", cell: (review) => <span className="whitespace-pre-wrap">{review.body}</span> },
          { header: "Rating", cell: (review) => `${review.rating}/10` },
          { header: "Status", cell: (review) => <ReviewStatus state={review.moderationState} /> },
          { header: "Updated", cell: (review) => <time dateTime={review.updatedAt}>{formatReviewDate(review.updatedAt)}</time> },
        ]}
        emptyMessage="No reviews yet. Browse movies when you are ready to share a thoughtful perspective."
        rowKey={(review) => review.id}
        rows={state.value.items}
      />
      <Pagination hrefForPage={(target) => `/app/reviews?page=${target}`} page={state.value.page} pageSize={state.value.pageSize} total={state.value.total} />
    </section>
  );
}
