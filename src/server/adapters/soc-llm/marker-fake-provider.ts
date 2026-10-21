import "server-only";

import type { Result } from "../../shared";
import type { LlmCompletion, LlmFailure, LlmMessage, LlmProvider, TokenUsage } from "./types";

// Canned outputs (D-57). `clean` and `flag` follow the field rules of ai.md AI-02; A-03 adds their conformance
// test against the AI-02 output schema (D-70). `summary` follows the D-87 schema; U-04 owns its conformance test.

/**
 * `[fake-llm:summary]`: a valid D-87 summary. It cites only `R1`–`R3`, which every published sample includes,
 * so the fixed output never invents a source (D-87).
 */
export const MARKER_FAKE_SUMMARY_OUTPUT = JSON.stringify({
  overall: "Fake provider: reviewers share a mix of praise and criticism.",
  strengths: [{ text: "Fake provider: some reviewers praise the film.", sources: ["R1", "R2"] }],
  criticisms: [{ text: "Fake provider: some reviewers criticise the film.", sources: ["R3"] }],
  mixedOpinions: [{ text: "Fake provider: opinions on the film are divided.", sources: ["R1", "R3"] }],
});

/** `[fake-llm:clean]`: a valid AI-02 `no_profanity_detected` output. */
export const MARKER_FAKE_CLEAN_OUTPUT = JSON.stringify({
  assessment: "no_profanity_detected",
  explanation: "Fake provider: no profanity detected.",
  matches: [],
  limitations: ["Output from the fake LLM provider."],
});

/** `[fake-llm:flag]`: a valid AI-02 `uncertain` output with no matches. */
export const MARKER_FAKE_FLAG_OUTPUT = JSON.stringify({
  assessment: "uncertain",
  explanation: "Fake provider: the review needs human review.",
  matches: [],
  limitations: ["Output from the fake LLM provider."],
});

/** `[fake-llm:invalid]`: content that is not JSON, so every feature's `validate` rejects it. */
export const MARKER_FAKE_INVALID_OUTPUT = "fake-llm invalid output";

/** The usage every fake success reports. */
export const MARKER_FAKE_USAGE: TokenUsage = Object.freeze({ inputTokens: 100, outputTokens: 50 });

const MARKER = /\[fake-llm:([^\]]*)\]/;

// Results are shared by every call, so they are frozen (D-23: no shared mutable state).
const success = (content: string): Result<LlmCompletion, LlmFailure> =>
  Object.freeze({ ok: true, value: Object.freeze({ content, usage: MARKER_FAKE_USAGE }) });
const failure = (error: LlmFailure): Result<LlmCompletion, LlmFailure> =>
  Object.freeze({ ok: false, error: Object.freeze(error) });

const UNAVAILABLE = failure({ kind: "unavailable" });
const TIMEOUT = failure({ kind: "timeout" });

/** Immediate outcomes by marker. `timeout` is handled separately because it waits for the signal. */
const OUTCOMES: ReadonlyMap<string, Result<LlmCompletion, LlmFailure>> = new Map([
  ["clean", success(MARKER_FAKE_CLEAN_OUTPUT)],
  ["flag", success(MARKER_FAKE_FLAG_OUTPUT)],
  ["summary", success(MARKER_FAKE_SUMMARY_OUTPUT)],
  ["invalid", success(MARKER_FAKE_INVALID_OUTPUT)],
  ["unavailable", UNAVAILABLE],
  ["rejected", failure({ kind: "rejected" })],
  ["rate_limited", failure({ kind: "rate_limited", retryAfterSeconds: null })],
]);

/** The first marker in a `user` message, in message order. The system message is never scanned (D-57). */
function firstMarker(messages: readonly LlmMessage[]): string | null {
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const match = MARKER.exec(message.content);
    if (match !== null) {
      return match[1];
    }
  }
  return null;
}

/**
 * The marker fake for running servers when `AI_PROVIDER=fake` (D-57). The outcome depends only on the first
 * `[fake-llm:<outcome>]` marker in user content; no marker or an unknown one gives `unavailable`, so it never
 * clears a Review unless the text asks it to. It holds no state, never logs and never rejects. An aborted
 * signal gives `timeout`.
 */
export function createMarkerFakeLlmProvider(deps: { readonly modelId: string }): LlmProvider {
  return Object.freeze({
    modelId: deps.modelId,
    complete({ messages, signal }: Parameters<LlmProvider["complete"]>[0]) {
      if (signal.aborted) {
        return Promise.resolve(TIMEOUT);
      }
      const marker = firstMarker(messages);
      if (marker === "timeout") {
        return new Promise<Result<LlmCompletion, LlmFailure>>((resolve) => {
          signal.addEventListener("abort", () => resolve(TIMEOUT), { once: true });
        });
      }
      const outcome = marker === null ? undefined : OUTCOMES.get(marker);
      return Promise.resolve(outcome ?? UNAVAILABLE);
    },
  });
}
