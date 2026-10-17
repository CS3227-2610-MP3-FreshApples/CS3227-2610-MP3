import "server-only";

import type { Result } from "../../shared";

// K10 provider contract (workflow/contracts.md §13, §22 AM-15; D-52, api.md 8.2). Imported only by
// src/server/services/ai/runtime/, the composition root (D-23) and tests/ (§23 AM-18).

export interface LlmMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type LlmFailure =
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number | null }
  | { readonly kind: "timeout" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "rejected" }
  | { readonly kind: "malformed_response" };

export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  readonly maxOutputTokens: number;
  /** The deadline: the controller derives it from the attempt timeout and the execution deadline (D-52). */
  readonly signal: AbortSignal;
}

export interface LlmCompletion {
  readonly content: string;
  /** `null` when the provider reports no usage; the controller then charges the reserved amount. */
  readonly usage: TokenUsage | null;
}

export interface LlmProvider {
  /** Fixed at construction, from SOC_LLM_MODEL (D-52). */
  readonly modelId: string;
  complete(request: LlmRequest): Promise<Result<LlmCompletion, LlmFailure>>;
}
