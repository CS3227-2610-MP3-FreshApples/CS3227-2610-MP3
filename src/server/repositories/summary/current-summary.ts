import "server-only";

/**
 * The D-93 rule, written once (D-96): a ReviewSummary is current when it is at the Movie's `reviews_revision` and
 * its job has the current summary prompt version. Each argument is a SQL expression from the caller's static text,
 * such as a column or a `$n` placeholder; never interpolate a value.
 */
export function currentSummaryExists(refs: {
  readonly movieId: string;
  readonly reviewsRevision: string;
  readonly promptVersion: string;
}): string {
  return `EXISTS (
           SELECT 1
           FROM app.review_summary s
           JOIN app.ai_job j ON j.id = s.job_id
           WHERE s.movie_id = ${refs.movieId}
             AND s.reviews_revision = ${refs.reviewsRevision}
             AND j.prompt_version = ${refs.promptVersion}
         )`;
}
