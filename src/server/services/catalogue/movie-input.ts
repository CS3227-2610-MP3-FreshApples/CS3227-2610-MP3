import "server-only";

import { z } from "zod";

import type { MovieMetadata } from "../../repositories/catalogue";
import type { FieldErrors, Result } from "../../shared";

// Admin Movie inputs (api.md 8.1, D-80). Limits are data-model.md's Movie row, in code points after trimming.

/** A full Movie on creation, with D-80 defaults applied to omitted optional fields. */
export type MovieCreateInput = MovieMetadata;
/** The supplied, nonempty subset of writable fields; an omitted field keeps its stored value. */
export type MoviePatchInput = Partial<MovieMetadata>;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function codePoints(value: string): number {
  return Array.from(value).length;
}

/** A real Gregorian date, years 0001–9999 (D-80); never a timestamp. */
function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= daysInMonth;
}

function trimmedText(min: number, max: number) {
  return z.string().trim().refine((value) => codePoints(value) >= min && codePoints(value) <= max, {
    message: min === 0 ? `must be at most ${max} characters` : `must be ${min} to ${max} characters`,
  });
}

function trimmedList(maxItems: number, maxItemLength: number) {
  return z.array(trimmedText(1, maxItemLength)).max(maxItems, { message: `must have at most ${maxItems} entries` });
}

const fields = {
  title: trimmedText(1, 200),
  synopsis: trimmedText(1, 5_000),
  releaseDate: z.string().refine(isCalendarDate, { message: "must be a calendar date YYYY-MM-DD" }).nullable(),
  genres: trimmedList(10, 40),
  director: trimmedText(0, 200),
  cast: trimmedList(30, 100),
  runtimeMinutes: z.number().int().min(1).max(1_000).nullable(),
};

const createSchema = z.strictObject({
  title: fields.title,
  synopsis: fields.synopsis,
  releaseDate: fields.releaseDate.default(null),
  genres: fields.genres.default([]),
  director: fields.director.default(""),
  cast: fields.cast.default([]),
  runtimeMinutes: fields.runtimeMinutes.default(null),
});

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
      add(key, issue.message.length > 0 && issue.code === "custom" ? issue.message : INVALID);
    } else {
      add("request", "must be a JSON object");
    }
  }
  return fieldErrors;
}

/** Validates a POST /admin/movies body: strict, trimmed, with D-80 defaults. */
export function parseMovieCreateInput(input: unknown): Result<MovieCreateInput, FieldErrors> {
  const parsed = createSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: toFieldErrors(parsed.error) };
}

/** Validates a PATCH /admin/movies/:id body: a strict, nonempty subset of writable fields (D-80). */
export function parseMoviePatchInput(input: unknown): Result<MoviePatchInput, FieldErrors> {
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: toFieldErrors(parsed.error) };
  }
  // Zod keeps only supplied keys, so an explicit null survives and an omitted field stays absent.
  if (Object.keys(parsed.data).length === 0) {
    return { ok: false, error: { request: ["must include at least one writable field"] } };
  }
  return { ok: true, value: parsed.data };
}
