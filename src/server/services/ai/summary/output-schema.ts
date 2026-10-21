import "server-only";

import { z } from "zod";

import type { Result } from "../../../shared";

/** D-87 bounds, in Unicode code points after trimming. */
export const SUMMARY_OVERALL_MAX_CODE_POINTS = 800;
export const SUMMARY_ITEM_MAX_CODE_POINTS = 240;
export const SUMMARY_MAX_ITEMS = 3;
export const SUMMARY_MAX_SOURCES = 20;

/** One strength, criticism or mixed opinion. `sources` are labels of included Reviews (D-86, D-87). */
export interface SummaryOutputItem {
  readonly text: string;
  readonly sources: readonly string[];
}

/** The validated D-87 output, stored as `output_json` and rendered only as escaped plain text. */
export interface SummaryOutput {
  readonly overall: string;
  readonly strengths: readonly SummaryOutputItem[];
  readonly criticisms: readonly SummaryOutputItem[];
  readonly mixedOpinions: readonly SummaryOutputItem[];
}

export type InvalidSummaryOutput = { readonly kind: "invalid_output" };

const INVALID: Result<never, InvalidSummaryOutput> = Object.freeze({
  ok: false,
  error: Object.freeze({ kind: "invalid_output" }),
});

const LINE_FEED = 0x0a;
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;
const URL_TEXT = /https?:\/\/|www\./i;
const MARKUP = /<[A-Za-z/!?]/;
const FENCE = "```";
const FENCE_TAG = "json";

function codePointCount(value: string): number {
  return Array.from(value).length;
}

/** D-87 safe text: no C0 control other than LF, no DEL, no URL and no markup. */
function isSafeText(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if ((code < FIRST_PRINTABLE && code !== LINE_FEED) || code === DELETE) {
      return false;
    }
  }
  return !URL_TEXT.test(value) && !MARKUP.test(value);
}

// zod runs `trim` before the refinements, so lengths and safe text are checked on the stored value.
function boundedText(maxCodePoints: number) {
  return z
    .string()
    .trim()
    .refine((value) => {
      const length = codePointCount(value);
      return length >= 1 && length <= maxCodePoints;
    })
    .refine(isSafeText);
}

const itemSchema = z.strictObject({
  text: boundedText(SUMMARY_ITEM_MAX_CODE_POINTS),
  sources: z
    .array(z.string())
    .min(1)
    .max(SUMMARY_MAX_SOURCES)
    .refine((sources) => new Set(sources).size === sources.length),
});

const listSchema = z.array(itemSchema).max(SUMMARY_MAX_ITEMS);

// Strict at every level: an unknown or missing key rejects the output (D-87).
const summaryOutputSchema = z.strictObject({
  overall: boundedText(SUMMARY_OVERALL_MAX_CODE_POINTS),
  strengths: listSchema,
  criticisms: listSchema,
  mixedOpinions: listSchema,
});

/** Strips one outer triple-backtick fence, optionally tagged `json` (D-87). */
function stripOuterFence(text: string): string {
  if (text.length < 2 * FENCE.length || !text.startsWith(FENCE) || !text.endsWith(FENCE)) {
    return text;
  }
  const inner = text.slice(FENCE.length, -FENCE.length);
  return inner.startsWith(FENCE_TAG) ? inner.slice(FENCE_TAG.length) : inner;
}

/**
 * Checks an already-parsed value against the D-87 schema, and every cited source against `labels`, the labels of
 * the included Reviews. A label removed by reduction, an unknown label and a raw Review ID are all rejected.
 */
export function validateSummaryOutput(
  value: unknown,
  labels: readonly string[],
): Result<SummaryOutput, InvalidSummaryOutput> {
  const parsed = summaryOutputSchema.safeParse(value);
  if (!parsed.success) {
    return INVALID;
  }
  const output: SummaryOutput = parsed.data;
  const included = new Set(labels);
  const cited = [...output.strengths, ...output.criticisms, ...output.mixedOpinions].flatMap(({ sources }) => sources);
  return cited.every((label) => included.has(label)) ? { ok: true, value: output } : INVALID;
}

/**
 * The K10 `validate` step for untrusted provider content (D-87, AI-04): trim, strip one outer fence, parse as
 * JSON, then `validateSummaryOutput`. No JSON response mode is relied on (O-27). Never throws.
 */
export function parseSummaryOutput(
  content: string,
  labels: readonly string[],
): Result<SummaryOutput, InvalidSummaryOutput> {
  let value: unknown;
  try {
    value = JSON.parse(stripOuterFence(content.trim()));
  } catch {
    return INVALID;
  }
  return validateSummaryOutput(value, labels);
}
