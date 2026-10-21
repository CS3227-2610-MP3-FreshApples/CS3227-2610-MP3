import "server-only";

import { z } from "zod";

import type { Result } from "../../../shared";
import { codePointCount, isSafeText, parseJsonContent } from "../output-text";

/** AI-02 bounds, in Unicode code points (D-100). */
export const MODERATION_EXPLANATION_MAX_CODE_POINTS = 800;
export const MODERATION_MAX_MATCHES = 10;
export const MODERATION_QUOTE_MAX_CODE_POINTS = 200;
export const MODERATION_REASON_MAX_CODE_POINTS = 240;
export const MODERATION_MAX_LIMITATIONS = 5;
export const MODERATION_LIMITATION_MAX_CODE_POINTS = 240;

export const MODERATION_ASSESSMENTS = ["suspected_profanity", "no_profanity_detected", "uncertain"] as const;
export type ModerationAssessment = (typeof MODERATION_ASSESSMENTS)[number];

export interface ModerationMatch {
  /** An exact substring of the screened body. */
  readonly quote: string;
  readonly reason: string;
}

/** The validated AI-02 output, stored as ReviewModeration `output_json` and shown only as escaped text. */
export interface ModerationOutput {
  readonly assessment: ModerationAssessment;
  readonly explanation: string;
  readonly matches: readonly ModerationMatch[];
  readonly limitations: readonly string[];
}

export type InvalidModerationOutput = { readonly kind: "invalid_output" };

const INVALID: Result<never, InvalidModerationOutput> = Object.freeze({
  ok: false,
  error: Object.freeze({ kind: "invalid_output" }),
});

function inRange(value: string, maxCodePoints: number): boolean {
  const length = codePointCount(value);
  return length >= 1 && length <= maxCodePoints;
}

// zod runs `trim` before the refinements, so lengths and safe text are checked on the stored value.
function boundedText(maxCodePoints: number) {
  return z
    .string()
    .trim()
    .refine((value) => inRange(value, maxCodePoints))
    .refine(isSafeText);
}

// Strict at every level: an unknown or missing key, or an unknown assessment, rejects the output (AI-02).
const moderationOutputSchema = z.strictObject({
  assessment: z.enum(MODERATION_ASSESSMENTS),
  explanation: boundedText(MODERATION_EXPLANATION_MAX_CODE_POINTS),
  matches: z
    .array(
      z.strictObject({
        // Not trimmed and not safe-text checked: it must copy the body exactly (D-100).
        quote: z.string().refine((value) => inRange(value, MODERATION_QUOTE_MAX_CODE_POINTS)),
        reason: boundedText(MODERATION_REASON_MAX_CODE_POINTS),
      }),
    )
    .max(MODERATION_MAX_MATCHES),
  limitations: z.array(boundedText(MODERATION_LIMITATION_MAX_CODE_POINTS)).max(MODERATION_MAX_LIMITATIONS),
});

/** AI-02: `suspected_profanity` requires a match and `no_profanity_detected` requires none. */
function matchesFitAssessment(output: ModerationOutput): boolean {
  switch (output.assessment) {
    case "suspected_profanity":
      return output.matches.length > 0;
    case "no_profanity_detected":
      return output.matches.length === 0;
    case "uncertain":
      return true;
  }
}

/**
 * Checks an already-parsed value against the AI-02 schema (D-100). Every quote must be an exact substring of
 * `body`, the text that was screened, so an invented or altered quotation is rejected.
 */
export function validateModerationOutput(value: unknown, body: string): Result<ModerationOutput, InvalidModerationOutput> {
  const parsed = moderationOutputSchema.safeParse(value);
  if (!parsed.success) {
    return INVALID;
  }
  const output: ModerationOutput = parsed.data;
  if (!matchesFitAssessment(output) || !output.matches.every(({ quote }) => body.includes(quote))) {
    return INVALID;
  }
  return { ok: true, value: output };
}

/**
 * The K10 `validate` step for untrusted provider content (AI-02, AI-04): the D-87 parse step, then
 * `validateModerationOutput`. Never throws.
 */
export function parseModerationOutput(content: string, body: string): Result<ModerationOutput, InvalidModerationOutput> {
  return validateModerationOutput(parseJsonContent(content), body);
}
