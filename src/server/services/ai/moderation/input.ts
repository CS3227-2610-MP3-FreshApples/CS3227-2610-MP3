import "server-only";

import type { ContentRevision, ReviewId, RowVersion } from "../../../shared";
import { estimateInputTokens, type BoundedInput, type LlmMessage } from "../runtime";
import { PROFANITY_POLICY_VERSION } from "./policy/version";
import { REVIEW_SCREENING_PROMPT_VERSION } from "./prompt-version";
import { REVIEW_SCREENING_SYSTEM_PROMPT } from "./prompt";

/** What one screening reads from the Review under its lock (K8 `ScreeningSource`, D-100). */
export interface ScreeningSubject {
  readonly reviewId: ReviewId;
  readonly contentRevision: ContentRevision;
  /** The captured `Review.version` that guards publication (AI-02). */
  readonly version: RowVersion;
  /** Untrusted text, sent complete or not at all. */
  readonly body: string;
}

export type ModerationInput =
  | { readonly kind: "ready"; readonly input: BoundedInput }
  /** The full body does not fit; AI-02 sends it to manual review, never a fragment. */
  | { readonly kind: "input_too_large" };

/** The system instructions, then one user message whose JSON escaping keeps the body inside its field (D-100). */
function screeningMessages(subject: ScreeningSubject): LlmMessage[] {
  const { reviewId, contentRevision, body } = subject;
  return [
    { role: "system", content: REVIEW_SCREENING_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify({ reviewId, contentRevision, body }) },
  ];
}

/**
 * D-100 input for one Review revision. Pure. Only the pseudonymous Review ID, the content revision, the complete
 * body and the versioned policy are sent (AI-02); the snapshot holds no Review text.
 *
 * @param inputTokenLimit `AI_INPUT_TOKEN_LIMIT`, compared with the AI-03 estimate of both messages.
 */
export function buildModerationInput(subject: ScreeningSubject, inputTokenLimit: number): ModerationInput {
  const messages = screeningMessages(subject);
  const estimatedInputTokens = estimateInputTokens(messages);
  if (estimatedInputTokens > inputTokenLimit) {
    return { kind: "input_too_large" };
  }
  return {
    kind: "ready",
    input: {
      messages,
      estimatedInputTokens,
      snapshot: {
        reviewId: subject.reviewId,
        contentRevision: subject.contentRevision,
        capturedVersion: subject.version,
        promptVersion: REVIEW_SCREENING_PROMPT_VERSION,
        policyVersion: PROFANITY_POLICY_VERSION,
      },
    },
  };
}
