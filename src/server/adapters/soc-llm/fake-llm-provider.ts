import "server-only";

import type { Result } from "../../shared";
import type { LlmCompletion, LlmFailure, LlmMessage, LlmProvider, TokenUsage } from "./types";

// For tests only (D-57): the composition root never imports this module. Running servers use
// the marker fake in marker-fake-provider.ts.

/**
 * One scripted `complete` result. Malformed output (D-53) is a `success` whose `content` fails the
 * caller's `validate`; a reply the adapter itself cannot parse is the `malformed_response` failure.
 */
export type FakeLlmOutcome =
  | { readonly kind: "success"; readonly content: string; readonly usage: TokenUsage | null }
  | { readonly kind: "failure"; readonly failure: LlmFailure }
  /** Settles only when the signal aborts, with `timeout`. */
  | { readonly kind: "hang" };

/** What the fake recorded for one call. The signal is not recorded. */
export interface RecordedLlmRequest {
  readonly messages: readonly LlmMessage[];
  readonly maxOutputTokens: number;
}

export interface FakeLlmProvider extends LlmProvider {
  /** Every request, in call order, including aborted ones. Never logged (D-53). */
  readonly requests: readonly RecordedLlmRequest[];
}

const UNAVAILABLE: Result<LlmCompletion, LlmFailure> = { ok: false, error: { kind: "unavailable" } };
const TIMEOUT: Result<LlmCompletion, LlmFailure> = { ok: false, error: { kind: "timeout" } };

/**
 * K10 scripted fake (workflow/contracts.md §13, §22 AM-16; D-53). Each call consumes the next outcome,
 * even when the signal is aborted, so call counts stay predictable. Once the script is used up, calls
 * return `unavailable`. An aborted signal gives `timeout`. The promise never rejects. There is no default
 * model ID, and no randomness, clock or network; results never depend on message content.
 */
export function createFakeLlmProvider(deps: {
  readonly modelId: string;
  readonly script: readonly FakeLlmOutcome[];
}): FakeLlmProvider {
  const script = [...deps.script];
  const requests: RecordedLlmRequest[] = [];
  let next = 0;

  return {
    modelId: deps.modelId,
    requests,
    complete({ messages, maxOutputTokens, signal }) {
      requests.push({ messages: messages.map((message) => ({ ...message })), maxOutputTokens });
      const outcome = next < script.length ? script[next] : null;
      next += 1;

      if (signal.aborted) {
        return Promise.resolve(TIMEOUT);
      }
      if (outcome === null) {
        return Promise.resolve(UNAVAILABLE);
      }
      switch (outcome.kind) {
        case "success":
          return Promise.resolve({ ok: true, value: { content: outcome.content, usage: outcome.usage } });
        case "failure":
          return Promise.resolve({ ok: false, error: outcome.failure });
        case "hang":
          return new Promise((resolve) => {
            signal.addEventListener("abort", () => resolve(TIMEOUT), { once: true });
          });
      }
    },
  };
}
