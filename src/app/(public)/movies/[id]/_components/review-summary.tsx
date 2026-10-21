import { Suspense } from "react";

import { publicSummaryReadService } from "../../../../../server/composition";
import type { PublicSummaryItem, PublicSummaryView } from "../../../../../server/services/ai/summary";
import type { MovieId } from "../../../../../server/shared";

/** The fixed AI-01 disclosure label. */
export const AI_SUMMARY_LABEL = "AI summary of a sample; may miss opinions or make mistakes";

type ReviewSummaryState = PublicSummaryView | { readonly status: "unavailable" };

/**
 * The FR-08 public review summary (D-90, D-98). It reads its own data, so the movie page only mounts it, and it
 * never throws to the page's error boundary. It has no generate or retry control.
 */
export function ReviewSummarySection({ movieId }: Readonly<{ movieId: MovieId }>) {
  return (
    <Suspense fallback={<p role="status">Loading review summary…</p>}>
      <ReviewSummaryContent movieId={movieId} />
    </Suspense>
  );
}

async function ReviewSummaryContent({ movieId }: Readonly<{ movieId: MovieId }>) {
  const state = await readSummary(movieId);
  return state === null ? null : <ReviewSummaryView state={state} />;
}

/** Null when the Movie was archived after the page read it (D-98 MD-4). */
async function readSummary(movieId: MovieId): Promise<ReviewSummaryState | null> {
  try {
    if (publicSummaryReadService === null) {
      return { status: "unavailable" };
    }
    return await publicSummaryReadService.getSummary(movieId);
  } catch {
    return { status: "unavailable" };
  }
}

/** Renders one summary state. All text is rendered by React as escaped plain text (AI-04). */
export function ReviewSummaryView({ state }: Readonly<{ state: ReviewSummaryState }>) {
  return (
    <section aria-labelledby="review-summary-heading">
      <h2 id="review-summary-heading">Review summary</h2>
      <ReviewSummaryBody state={state} />
    </section>
  );
}

function ReviewSummaryBody({ state }: Readonly<{ state: ReviewSummaryState }>) {
  switch (state.status) {
    case "unavailable":
      return <p role="status">The review summary is temporarily unavailable.</p>;
    case "insufficient_reviews":
      return <p role="status">Not enough reviews for a summary yet (at least 3 are needed).</p>;
    case "missing":
    case "stale":
      return <p role="status">A review summary is awaiting its scheduled update.</p>;
    case "ready": {
      const { summary, eligibleCount } = state;
      return (
        <>
          <p>{AI_SUMMARY_LABEL}</p>
          <p>{summary.overall}</p>
          <SummaryList heading="Strengths" items={summary.strengths} />
          <SummaryList heading="Criticisms" items={summary.criticisms} />
          <SummaryList heading="Mixed opinions" items={summary.mixedOpinions} />
          <p>{`Based on ${summary.includedCount} of ${eligibleCount} eligible reviews.`}</p>
          <p>
            Generated <time dateTime={summary.generatedAt}>{utcMinute(summary.generatedAt)}</time>
          </p>
          {summary.truncated ? (
            <p>Some reviews were shortened to their first 1,000 characters before summarizing.</p>
          ) : null}
        </>
      );
    }
  }
}

function SummaryList({ heading, items }: Readonly<{ heading: string; items: readonly PublicSummaryItem[] }>) {
  return (
    <>
      <h3>{heading}</h3>
      {items.length === 0 ? (
        <p>None noted.</p>
      ) : (
        <ul>
          {items.map((item, index) => (
            <li key={index}>{item.text}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** `YYYY-MM-DD HH:mm UTC` from the server's ISO 8601 UTC time, independent of the locale (D-98 MD-3). */
function utcMinute(isoUtc: string): string {
  return `${isoUtc.slice(0, 10)} ${isoUtc.slice(11, 16)} UTC`;
}
