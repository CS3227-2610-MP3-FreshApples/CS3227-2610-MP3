import "server-only";

import type { MovieId } from "../../../shared";
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

export function createSummaryGeneration(deps: {
  readonly preparation: SummaryInputPreparation;
  readonly controller: AiExecutionController;
  readonly publisher: SummaryPublisher;
}): SummaryGeneration {
  return {
    async generate(movieId) {
      const prepared = await deps.preparation.prepare(movieId);
      if (prepared.kind !== "ready") {
        return prepared;
      }
      const { reviewsRevision, eligibleCount, sample, labels, input } = prepared;
      const publication: SummaryPublication = { movieId, reviewsRevision, eligibleCount, sample };
      // K10 deduplicates a running job for the same Movie, revision, model and prompt version (D-88).
      return deps.controller.run<SummaryOutput>({
        job: { type: "summary", movieId, reviewsRevision, promptVersion: SUMMARY_PROMPT_VERSION },
        input,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        validate: (content) => parseSummaryOutput(content, labels),
        publish: (tx, output, job) => deps.publisher.publish(tx, publication, output, job),
      });
    },
  };
}
