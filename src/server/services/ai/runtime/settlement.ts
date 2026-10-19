import "server-only";

import type { LlmCompletion, LlmFailure, TokenUsage } from "../../../adapters/soc-llm";
import type { ReservationSettlement } from "../../../repositories/ai";
import type { Result } from "../../../shared";
import { costMicrodollars, type TokenPrices } from "./pricing";

/** What one sent provider request may have cost (D-63, D-74, D-75). */
export type AttemptCharge =
  /** Refused before generation (a 4xx other than 408, or a 3xx): charged 0 and not costed. */
  | { readonly kind: "refused" }
  /** Usage is unknown: charged the reserved amount R. */
  | { readonly kind: "unknown" }
  | { readonly kind: "priced"; readonly microdollars: number; readonly usage: TokenUsage };

const REFUSED: AttemptCharge = Object.freeze({ kind: "refused" });
const UNKNOWN: AttemptCharge = Object.freeze({ kind: "unknown" });
/** The range of the `integer` token columns (D-75). */
const MAX_TOKEN_COLUMN = 2_147_483_647;

export function attemptCharge(result: Result<LlmCompletion, LlmFailure>, prices: TokenPrices): AttemptCharge {
  if (result.ok) {
    const { usage } = result.value;
    const microdollars = usage === null ? null : costMicrodollars(usage.inputTokens, usage.outputTokens, prices);
    return usage === null || microdollars === null ? UNKNOWN : { kind: "priced", microdollars, usage };
  }
  switch (result.error.kind) {
    case "rate_limited": // 429
    case "rejected": // other 4xx
    case "misconfigured": // 401, 403, 404 or 3xx
      return REFUSED;
    case "timeout": // 408, abort or deadline
    case "unavailable": // 5xx or network
    case "malformed_response": // a 200 that could not be used
      return UNKNOWN;
  }
}

/**
 * D-63: `released` when no sent request could have cost anything; otherwise `reconciled` at the sum of the attempt
 * charges, with usage and the actual amount recorded only when every costed attempt reported usage.
 */
export function planSettlement(charges: readonly AttemptCharge[], reservedMicrodollars: number): ReservationSettlement {
  const costed = charges.filter((charge) => charge.kind !== "refused");
  if (costed.length === 0) {
    return { status: "released", chargeMicrodollars: 0 };
  }
  const total = costed.reduce(
    (sum, charge) => sum + (charge.kind === "priced" ? charge.microdollars : reservedMicrodollars),
    0,
  );
  // Capped at the day's headroom when applied, so clamping an unrepresentable sum changes nothing recorded.
  const chargeMicrodollars = Math.min(total, Number.MAX_SAFE_INTEGER);
  const priced = costed.filter((charge) => charge.kind === "priced");
  if (priced.length !== costed.length) {
    return { status: "reconciled", chargeMicrodollars, inputTokens: null, outputTokens: null, actualMicrodollars: null };
  }
  const inputTokens = priced.reduce((sum, charge) => sum + charge.usage.inputTokens, 0);
  const outputTokens = priced.reduce((sum, charge) => sum + charge.usage.outputTokens, 0);
  const tokensFit = inputTokens <= MAX_TOKEN_COLUMN && outputTokens <= MAX_TOKEN_COLUMN;
  return {
    status: "reconciled",
    chargeMicrodollars,
    inputTokens: tokensFit ? inputTokens : null,
    outputTokens: tokensFit ? outputTokens : null,
    actualMicrodollars: chargeMicrodollars,
  };
}
