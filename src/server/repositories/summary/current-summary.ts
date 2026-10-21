import "server-only";

/**
 * Each argument is a SQL expression from the caller's static text, such as a column or a `$n` placeholder; never
 * interpolate a value (Q2-4).
 */
export interface SummaryRefs {
  readonly movieId: string;
  readonly reviewsRevision: string;
  readonly promptVersion: string;
}

/**
 * The D-93 rule, written once (D-96, D-98): a ReviewSummary is current when it is at the Movie's `reviews_revision`
 * and its job has the current summary prompt version. Returns `FROM … WHERE …` over the aliases `cs`
 * (review_summary) and `cj` (ai_job), which the caller's refs must not use.
 */
export function currentSummaryRows(refs: SummaryRefs): string {
  return `FROM app.review_summary cs
           JOIN app.ai_job cj ON cj.id = cs.job_id
           WHERE cs.movie_id = ${refs.movieId}
             AND cs.reviews_revision = ${refs.reviewsRevision}
             AND cj.prompt_version = ${refs.promptVersion}`;
}

/** Whether a current ReviewSummary exists (D-93). */
export function currentSummaryExists(refs: SummaryRefs): string {
  return `EXISTS (SELECT 1 ${currentSummaryRows(refs)})`;
}

/** Whether a ReviewSummary at the Movie's revision has an older prompt version, so it is retired (D-93, D-94). */
export function retiredSummaryExists(refs: SummaryRefs): string {
  return `EXISTS (
           SELECT 1
           FROM app.review_summary rs
           JOIN app.ai_job rj ON rj.id = rs.job_id
           WHERE rs.movie_id = ${refs.movieId}
             AND rs.reviews_revision = ${refs.reviewsRevision}
             AND rj.prompt_version <> ${refs.promptVersion}
         )`;
}
