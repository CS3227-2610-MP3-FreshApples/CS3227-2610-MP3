import "server-only";

import type { AccountId, MovieId } from "../../../shared";
import type { AiExecutionController, AiExecutionOutcome } from "../runtime";
import type { SummaryInputPreparation, SummaryPreparation } from "./input-preparation";
import { parseSummaryOutput, type SummaryOutput } from "./output-schema";
import { SUMMARY_MAX_OUTPUT_TOKENS, SUMMARY_PROMPT_VERSION } from "./prompt";
import type { SummaryPublication, SummaryPublisher } from "./publication";

/**
 * D-89: `unavailable`, `insufficient_reviews`, `input_unfit` or `current` with no K10 call, or else the K10
 * outcome unchanged. Mapping outcomes to schedule writes is the sweep's (B#14).
 */
export type SummaryGenerationOutcome = Exclude<SummaryPreparation, { readonly kind: "ready" }> | AiExecutionOutcome;

export interface SummaryGeneration {
  /**
   * Generates the summary for one Movie (D-89). Call it with no Tx open. It never writes schedule columns and
   * never throws for an expected outcome; an infrastructure fault in the D-86 read propagates.
   */
  generate(movieId: MovieId): Promise<SummaryGenerationOutcome>;
}

export interface AdminSummaryGeneration {
  /** Explicit Admin generation. The requester is persisted in the private AI job provenance. */
  generateForAdmin(movieId: MovieId, requesterId: AccountId): Promise<SummaryGenerationOutcome>;
}

export function createSummaryGeneration(deps: {
  readonly preparation: SummaryInputPreparation;
  readonly controller: AiExecutionController;
  readonly publisher: SummaryPublisher;
}): SummaryGeneration & AdminSummaryGeneration {
  async function generateWithDescriptor(movieId: MovieId, requesterId?: AccountId): Promise<SummaryGenerationOutcome> {
    const prepared = await deps.preparation.prepare(movieId);
    if (prepared.kind !== "ready") {
      return prepared;
    }
    const { reviewsRevision, eligibleCount, sample, labels, input } = prepared;
    const publication: SummaryPublication = { movieId, reviewsRevision, eligibleCount, sample };
    return deps.controller.run<SummaryOutput>({
      job: {
        type: "summary",
        movieId,
        reviewsRevision,
        ...(requesterId === undefined ? {} : { requesterId }),
        promptVersion: SUMMARY_PROMPT_VERSION,
      },
      input,
      maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      validate: (content) => parseSummaryOutput(content, labels),
      publish: (tx, output, job) => deps.publisher.publish(tx, publication, output, job.jobId),
    });
  }

  return {
    generate: (movieId) => generateWithDescriptor(movieId),
    generateForAdmin: (movieId, requesterId) => generateWithDescriptor(movieId, requesterId),
  };
}
