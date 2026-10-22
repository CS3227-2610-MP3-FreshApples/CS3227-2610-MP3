import { RatingValue } from "../../../../components/rating-primitives";
import { StatusBadge } from "../../../../components/status-primitives";
import { formatUtc } from "../../_lib/admin-http";
import type { AdminReviewView } from "../../_lib/review-client";

/** Plain React text children only: both the source and stored AI output are untrusted text. */
export function ReviewSource({ review }: Readonly<{ review: AdminReviewView }>) {
  const assessment = review.latestAssessment;
  const historical = assessment !== null && assessment.contentRevision !== review.contentRevision;
  return <div className="grid gap-6 md:grid-cols-2">
    <section aria-labelledby="review-source-title" className="min-w-0 space-y-3 rounded-lg border border-slate-300 bg-white p-5">
      <h2 className="text-xl font-semibold" id="review-source-title">Current review text</h2>
      <p>By {review.authorDisplayName} · <RatingValue value={review.rating} /></p>
      <p className="whitespace-pre-wrap break-words">{review.body}</p>
      <p className="text-sm text-slate-600">Review version {review.version} · Content revision {review.contentRevision}</p>
    </section>
    <section aria-labelledby="automatic-assessment-title" className="min-w-0 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-5">
      <h2 className="text-xl font-semibold" id="automatic-assessment-title">Automatic assessment</h2>
      <p>This AI-generated assessment can be wrong. It is not a human decision.</p>
      {assessment === null ? <p>No automatic assessment is available for this review.</p> : <>
        {historical ? <StatusBadge label="Historical assessment — earlier text" tone="warning" /> : null}
        {historical ? <p>This assessment is for content revision {assessment.contentRevision}, not the current text.</p> : null}
        <StatusBadge tone="neutral" label={{ suspected_profanity: "Suspected profanity", uncertain: "Uncertain", no_profanity_detected: "No profanity detected" }[assessment.result.assessment]} />
        <p className="whitespace-pre-wrap break-words">{assessment.result.explanation}</p>
        {assessment.result.matches.length > 0 ? <>
          <h3 className="font-semibold">Cited passages</h3>
          <ul className="list-disc space-y-2 pl-5">{assessment.result.matches.map((match, index) => <li key={index}>
            <blockquote className="whitespace-pre-wrap break-words">{match.quote}</blockquote>
            <p className="whitespace-pre-wrap break-words">{match.reason}</p>
          </li>)}</ul>
        </> : null}
        <p className="text-sm">Generated <time dateTime={assessment.generatedAt}>{formatUtc(assessment.generatedAt)}</time> for content revision {assessment.contentRevision} (Review version {assessment.capturedReviewVersion}).</p>
        <p className="break-words text-sm">Model: {assessment.modelId} · Prompt: {assessment.promptVersion} · Policy: {assessment.policyVersion}</p>
      </>}
      <h3 className="font-semibold">Limitations</h3>
      <p>Automatic screening may miss profanity or misread context. Read the source text before making a decision.</p>
      {assessment !== null && assessment.result.limitations.length > 0
        ? <ul className="list-disc space-y-1 pl-5">{assessment.result.limitations.map((text, index) => <li className="whitespace-pre-wrap break-words" key={index}>{text}</li>)}</ul>
        : <p>No additional limitations were supplied.</p>}
    </section>
  </div>;
}
