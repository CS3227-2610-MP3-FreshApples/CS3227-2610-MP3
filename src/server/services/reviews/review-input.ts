import "server-only";

import { z } from "zod";

import type { FieldErrors, Result } from "../../shared";

export interface ReviewCreateInput {
  readonly rating: number;
  readonly body: string;
}

export type ReviewPatchInput = Partial<ReviewCreateInput>;

function codePoints(value: string): number {
  return Array.from(value).length;
}

function reviewBody() {
  return z.string().trim().refine((value) => codePoints(value) >= 10 && codePoints(value) <= 2_000, {
    message: "must be 10 to 2,000 characters",
  });
}

const fields = {
  rating: z.number().int().min(1).max(10),
  body: reviewBody(),
};

const createSchema = z.strictObject(fields);
const patchSchema = z.strictObject(fields).partial();

const NOT_WRITABLE = "is not a writable field";
const INVALID = "invalid value";

function toFieldErrors(error: z.ZodError): FieldErrors {
  const fieldErrors: Record<string, string[]> = {};
  const add = (key: string, message: string) => {
    (fieldErrors[key] ??= []).push(message);
  };
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) add(key, NOT_WRITABLE);
      continue;
    }
    const key = issue.path[0];
    if (typeof key === "string") {
      add(key, issue.code === "custom" ? issue.message : INVALID);
    } else {
      add("request", "must be a JSON object");
    }
  }
  return fieldErrors;
}

/** Validates a POST /movies/:id/reviews body. */
export function parseReviewCreateInput(input: unknown): Result<ReviewCreateInput, FieldErrors> {
  const parsed = createSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: toFieldErrors(parsed.error) };
}

/** Validates a PATCH /reviews/:id body and rejects an empty patch. */
export function parseReviewPatchInput(input: unknown): Result<ReviewPatchInput, FieldErrors> {
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: toFieldErrors(parsed.error) };
  }
  if (Object.keys(parsed.data).length === 0) {
    return { ok: false, error: { request: ["must include at least one writable field"] } };
  }
  return { ok: true, value: parsed.data };
}
