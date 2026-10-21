import "server-only";

import { z } from "zod";

import type { FieldErrors, ReportCategory, Result, ReviewId } from "../../shared";

export interface ReportInput {
  readonly category: ReportCategory;
  readonly explanation: string;
}

export interface ReportSubmissionInput extends ReportInput {
  readonly reviewId: ReviewId;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function codePoints(value: string): number { return Array.from(value).length; }
const explanation = z.string().trim().refine((value) => codePoints(value) >= 10 && codePoints(value) <= 1_000, { message: "must contain 10 to 1,000 characters" });
const reportFields = { category: z.enum(["profanity", "harassment", "hate", "spam", "other"] satisfies readonly ReportCategory[]), explanation };
const reportSchema = z.strictObject(reportFields);
const submissionSchema = z.strictObject({ reviewId: z.string().regex(UUID_PATTERN, { message: "must be a UUID" }).transform((value) => value as ReviewId), ...reportFields });

const INVALID = "invalid value";
const NOT_WRITABLE = "is not a writable field";

function toFieldErrors(error: z.ZodError): FieldErrors {
  const fieldErrors: Record<string, string[]> = {};
  const add = (key: string, message: string) => { (fieldErrors[key] ??= []).push(message); };
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) add(key, NOT_WRITABLE);
      continue;
    }
    const key = issue.path[0];
    add(typeof key === "string" ? key : "request", issue.code === "custom" || issue.code === "invalid_format" ? issue.message : INVALID);
  }
  return fieldErrors;
}

export function parseReportInput(input: unknown): Result<ReportInput, FieldErrors> {
  const parsed = reportSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: toFieldErrors(parsed.error) };
}

export function parseReportSubmissionInput(input: unknown): Result<ReportSubmissionInput, FieldErrors> {
  const parsed = submissionSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: toFieldErrors(parsed.error) };
}
