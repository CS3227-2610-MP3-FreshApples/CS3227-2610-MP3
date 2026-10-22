import { Suspense } from "react";

import { StatusMessage } from "../../../components/status-primitives";
import { UserBackLink } from "../_components/user-ui";
import { pageFromSearchParam } from "./_lib/review-client";
import { ReviewList } from "./_components/review-list";

type UserReviewsPageProps = Readonly<{
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}>;

export default function UserReviewsPage({ searchParams = Promise.resolve({}) }: UserReviewsPageProps) {
  return (
    <section className="space-y-8" aria-labelledby="user-reviews-title">
      <UserBackLink href="/app" label="Go back to overview" />
      <header className="max-w-3xl space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">Your account</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl" id="user-reviews-title">My reviews</h1>
        <p className="text-lg leading-8 text-slate-600">Your pending, held, and published reviews appear here. Deleted and hidden reviews are not shown.</p>
      </header>
      <section aria-label="Review status">
        <Suspense fallback={<StatusMessage status="info">Loading reviews…</StatusMessage>}>
          {searchParams.then((query) => <ReviewList page={pageFromSearchParam(query.page)} />)}
        </Suspense>
      </section>
    </section>
  );
}
