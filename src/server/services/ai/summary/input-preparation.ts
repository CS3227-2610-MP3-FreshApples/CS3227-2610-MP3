import "server-only";

import type { Database } from "../../../db";
import type { EligibleReviewRecord, SummaryInputRepository, SummaryInputSnapshot } from "../../../repositories/summary";
import type { ContentRevision, MovieId, ReviewId, ReviewsRevision, RowVersion } from "../../../shared";
import { estimateInputTokens, type AiRuntime, type BoundedInput, type LlmMessage } from "../runtime";
import { SUMMARY_PROMPT_VERSION, SUMMARY_SYSTEM_PROMPT } from "./prompt";
import {
  sampleWithoutReplacement,
  seededUint32Source,
  SUMMARY_SAMPLE_ALGORITHM,
  type SummarySeedSource,
} from "./sampling";

/** AI-01 item 3: fewer eligible or fitting Reviews than this never produce a summary. */
export const MIN_SUMMARY_REVIEWS = 3;

/** AI-01 item 5: each body is cut to this many Unicode code points. */
export const SUMMARY_BODY_MAX_CODE_POINTS = 1_000;

/**
 * `sampleSize` is `AI_SUMMARY_SAMPLE_SIZE` (3–20) and `inputTokenLimit` is `AI_INPUT_TOKEN_LIMIT`, the bound K10
 * enforces. Derived from `AiRuntime`, which builds them from the real controller's settings, so the shape is
 * declared once (D-93, D-96).
 */
export type SummaryLimits = NonNullable<AiRuntime["summaryLimits"]>;

/** One included Review in `sampled_review_ids_and_versions.reviews`; label `R<k>` is entry k − 1 (D-88). */
export interface SummarySampleReview {
  readonly reviewId: ReviewId;
  readonly version: RowVersion;
  readonly contentRevision: ContentRevision;
  readonly truncated: boolean;
}

/** Persisted as `sampled_review_ids_and_versions` (D-88). Holds no Review text. */
export interface SummarySample {
  readonly algorithm: typeof SUMMARY_SAMPLE_ALGORITHM;
  /** 64 lowercase hex characters. */
  readonly seed: string;
  /** The sample size before reduction, so a replay can confirm `reviews` is its prefix. */
  readonly sampledCount: number;
  /** The included Reviews only, in label order. */
  readonly reviews: readonly SummarySampleReview[];
}

export type SummaryPreparation =
  /** The Movie is missing or archived. */
  | { readonly kind: "unavailable" }
  | { readonly kind: "insufficient_reviews"; readonly eligibleCount: number }
  /** A ReviewSummary already exists at the current revision and prompt version (D-88, D-93). */
  | { readonly kind: "current" }
  /** Fewer than 3 Reviews fit the input limit (D-86). */
  | { readonly kind: "input_unfit" }
  | {
      readonly kind: "ready";
      readonly reviewsRevision: ReviewsRevision;
      readonly eligibleCount: number;
      readonly sample: SummarySample;
      /** `R1`–`Rn` for the included Reviews; the only labels output may cite (D-87). */
      readonly labels: readonly string[];
      /** `snapshot` is `{ movieId, reviewsRevision, eligibleCount, sample }` (D-88). */
      readonly input: BoundedInput;
    };

/** The record sent for each Review (D-86); its key order is part of the prompt version. */
interface ReviewRecord {
  readonly label: string;
  readonly rating: string;
  readonly truncated: boolean;
  readonly body: string;
}

interface BoundedReview {
  readonly review: EligibleReviewRecord;
  readonly record: ReviewRecord;
}

function boundBody(body: string): { readonly body: string; readonly truncated: boolean } {
  const codePoints = Array.from(body);
  return codePoints.length > SUMMARY_BODY_MAX_CODE_POINTS
    ? { body: codePoints.slice(0, SUMMARY_BODY_MAX_CODE_POINTS).join(""), truncated: true }
    : { body, truncated: false };
}

function boundReview(review: EligibleReviewRecord, position: number): BoundedReview {
  const { body, truncated } = boundBody(review.body);
  return { review, record: { label: `R${position + 1}`, rating: `${review.rating}/10`, truncated, body } };
}

/** The system prompt, then one user message whose JSON escaping keeps Review text inside its field. */
function summaryMessages(included: readonly BoundedReview[]): LlmMessage[] {
  return [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify({ reviews: included.map(({ record }) => record) }) },
  ];
}

/**
 * D-86 input preparation for one consistent snapshot of an active Movie. Pure: the same snapshot, limits and
 * seed always give the same result.
 */
export function prepareSummaryInput(
  movieId: MovieId,
  snapshot: SummaryInputSnapshot,
  limits: SummaryLimits,
  seed: Buffer,
): Exclude<SummaryPreparation, { readonly kind: "unavailable" }> {
  const eligibleCount = snapshot.reviews.length;
  if (eligibleCount < MIN_SUMMARY_REVIEWS) {
    return { kind: "insufficient_reviews", eligibleCount };
  }
  if (snapshot.hasCurrentSummary) {
    return { kind: "current" };
  }

  const sampled = sampleWithoutReplacement(snapshot.reviews, limits.sampleSize, seededUint32Source(seed));
  // Reduction removes whole Reviews from the end of the sample order, so remaining labels never change.
  const included = sampled.map(boundReview);
  let messages = summaryMessages(included);
  let estimate = estimateInputTokens(messages);
  while (estimate > limits.inputTokenLimit && included.length >= MIN_SUMMARY_REVIEWS) {
    included.pop();
    messages = summaryMessages(included);
    estimate = estimateInputTokens(messages);
  }
  if (included.length < MIN_SUMMARY_REVIEWS) {
    return { kind: "input_unfit" };
  }

  const sample: SummarySample = {
    algorithm: SUMMARY_SAMPLE_ALGORITHM,
    seed: seed.toString("hex"),
    sampledCount: sampled.length,
    reviews: included.map(({ review, record }) => ({
      reviewId: review.id,
      version: review.version,
      contentRevision: review.contentRevision,
      truncated: record.truncated,
    })),
  };
  return {
    kind: "ready",
    reviewsRevision: snapshot.reviewsRevision,
    eligibleCount,
    sample,
    labels: included.map(({ record }) => record.label),
    input: {
      messages,
      estimatedInputTokens: estimate,
      snapshot: { movieId, reviewsRevision: snapshot.reviewsRevision, eligibleCount, sample },
    },
  };
}

export interface SummaryInputPreparation {
  /**
   * Reads the D-86 snapshot in its own short Tx and prepares the input. Call it with no Tx open. Writes
   * nothing and never calls K10, so no outcome here creates an AIJob or reservation.
   */
  prepare(movieId: MovieId): Promise<SummaryPreparation>;
}

export function createSummaryInputPreparation(deps: {
  readonly database: Database;
  readonly inputs: SummaryInputRepository;
  readonly limits: SummaryLimits;
  /** `systemSeedSource` in production; fixed in tests. */
  readonly seedSource: SummarySeedSource;
}): SummaryInputPreparation {
  return {
    async prepare(movieId) {
      const snapshot = await deps.database.withTransaction((tx) =>
        deps.inputs.readSnapshot(tx, movieId, SUMMARY_PROMPT_VERSION),
      );
      if (snapshot === null) {
        return { kind: "unavailable" };
      }
      return prepareSummaryInput(movieId, snapshot, deps.limits, deps.seedSource());
    },
  };
}
