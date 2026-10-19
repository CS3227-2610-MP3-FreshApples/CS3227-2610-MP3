import "server-only";

import type { LlmMessage } from "../../../adapters/soc-llm";

/** Verified per-million-token prices of the configured model (D-25, D-48). */
export interface TokenPrices {
  readonly inputMicrodollarsPerMTok: number;
  readonly outputMicrodollarsPerMTok: number;
}

const BYTES_PER_TOKEN = 3;
const TOKENS_PER_MESSAGE = 16;
const TOKENS_PER_MTOK = BigInt(1_000_000);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * The AI-03 input estimate (O-26): ceil(UTF-8 bytes of every message's content ÷ 3) + 16 per message. Not an upper
 * bound; reconciliation uses provider-reported usage.
 */
export function estimateInputTokens(messages: readonly LlmMessage[]): number {
  const bytes = messages.reduce((total, message) => total + Buffer.byteLength(message.content, "utf8"), 0);
  return Math.ceil(bytes / BYTES_PER_TOKEN) + TOKENS_PER_MESSAGE * messages.length;
}

/**
 * The AI-03 cost in microdollars, ceil((input × input price + output × output price) ÷ 1,000,000), computed exactly.
 * `null` when the result is not a safe integer, which callers treat as unknown (D-75).
 */
export function costMicrodollars(inputTokens: number, outputTokens: number, prices: TokenPrices): number | null {
  const numerator =
    BigInt(inputTokens) * BigInt(prices.inputMicrodollarsPerMTok) +
    BigInt(outputTokens) * BigInt(prices.outputMicrodollarsPerMTok);
  const cost = (numerator + TOKENS_PER_MTOK - BigInt(1)) / TOKENS_PER_MTOK;
  return cost <= MAX_SAFE ? Number(cost) : null;
}
