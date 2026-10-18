import "server-only";

import type { Sql } from "../../../db";
import { createModerationWorkRepository } from "../../../repositories/ai";
import { PROFANITY_POLICY_VERSION } from "./policy/version";
import { REVIEW_SCREENING_PROMPT_VERSION } from "./prompt-version";
import type { ModerationWorkQueue } from "./types";

/**
 * K9 ModerationWork queue (D-50). Runs inside the caller's Tx, which already holds the Review `FOR UPDATE` lock
 * (D-58). The prompt and policy versions are module constants (D-49), and the model is left NULL until first
 * dispatch, so the queue never reads AI configuration.
 */
export function createModerationWorkQueue(deps: { sql: Sql }): ModerationWorkQueue {
  const work = createModerationWorkRepository({ sql: deps.sql });
  return {
    async enqueue(tx, reviewId, contentRevision) {
      await work.supersedeBelowRevision(tx, reviewId, contentRevision);
      await work.insertPendingUnlessRecorded(tx, {
        reviewId,
        contentRevision,
        promptVersion: REVIEW_SCREENING_PROMPT_VERSION,
        policyVersion: PROFANITY_POLICY_VERSION,
      });
    },
    cancelForDeletedReview(tx, reviewId) {
      return work.cancelOutstanding(tx, reviewId);
    },
  };
}
