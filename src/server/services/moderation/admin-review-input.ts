import "server-only";

import { z } from "zod";
import type { FieldErrors, Result } from "../../shared";

export const ADMIN_REVIEW_ASSESSMENTS = [
  "all", "pending", "flagged", "cleared", "needs_manual_review", "failed", "hidden", "deleted",
  "suspected_profanity", "no_profanity_detected", "uncertain",
] as const;
export interface AdminReviewFilters {
  readonly movieId: string | null;
  readonly assessment: (typeof ADMIN_REVIEW_ASSESSMENTS)[number];
}
export interface AdminReviewReason { readonly reason: string }

const reasonSchema = z.strictObject({
  reason: z.string().trim().refine((value) => {
    const length = Array.from(value).length;
    return length >= 10 && length <= 1_000;
  }, { message: "must contain 10 to 1,000 characters" }),
});

export function parseAdminReviewReason(input: unknown): Result<AdminReviewReason, FieldErrors> {
  const parsed = reasonSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) errors[key] = ["is not a writable field"];
    } else {
      const field = typeof issue.path[0] === "string" ? issue.path[0] : "request";
      errors[field] = [issue.code === "custom" ? issue.message : "invalid value"];
    }
  }
  return { ok: false, error: errors };
}

export function parseAdminReviewFilters(query: URLSearchParams): Result<AdminReviewFilters, FieldErrors> {
  const movieId = query.get("movieId");
  const raw = query.get("assessment") ?? "all";
  const assessment = raw === "needs-manual-review" ? "needs_manual_review" : raw;
  const parsed = z.enum(ADMIN_REVIEW_ASSESSMENTS).safeParse(assessment);
  const errors: Record<string, string[]> = {};
  if (movieId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(movieId)) {
    errors.movieId = ["must be a UUID"];
  }
  if (!parsed.success) errors.assessment = ["invalid assessment filter"];
  return parsed.success && Object.keys(errors).length === 0
    ? { ok: true, value: { movieId, assessment: parsed.data } }
    : { ok: false, error: errors };
}
