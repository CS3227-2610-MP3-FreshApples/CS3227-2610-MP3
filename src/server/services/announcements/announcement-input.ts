import "server-only";

import { z } from "zod";

import type { AnnouncementContent } from "../../repositories/announcements";
import type { FieldErrors, Result } from "../../shared";

// Admin Announcement inputs (api.md 8.1, D-80). Limits are data-model.md's Announcement row, in code points
// after trimming.

/** A new Announcement's content; an omitted movieId is null. State is always draft on creation (D-79). */
export type AnnouncementCreateInput = AnnouncementContent;
/** The supplied, nonempty subset of writable fields; an omitted field keeps its stored value. */
export type AnnouncementPatchInput = Partial<AnnouncementContent> & { readonly state?: "draft" | "published" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function codePoints(value: string): number {
  return Array.from(value).length;
}

function trimmedText(min: number, max: number) {
  return z.string().trim().refine((value) => codePoints(value) >= min && codePoints(value) <= max, {
    message: `must be ${min} to ${max} characters`,
  });
}

const fields = {
  title: trimmedText(1, 200),
  body: trimmedText(1, 5_000),
  // Lowercased so a same-value PATCH compares equal to the stored UUID.
  movieId: z
    .string()
    .regex(UUID_PATTERN, { message: "must be a Movie ID" })
    .transform((value) => value.toLowerCase())
    .nullable(),
};

const createSchema = z.strictObject({
  title: fields.title,
  body: fields.body,
  movieId: fields.movieId.default(null),
});

const patchSchema = z.strictObject({ ...fields, state: z.enum(["draft", "published"]) }).partial();

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
      add(key, issue.message.length > 0 && (issue.code === "custom" || issue.code === "invalid_format") ? issue.message : INVALID);
    } else {
      add("request", "must be a JSON object");
    }
  }
  return fieldErrors;
}

/** Validates a POST /admin/announcements body: strict and trimmed; state and actor fields are not writable. */
export function parseAnnouncementCreateInput(input: unknown): Result<AnnouncementCreateInput, FieldErrors> {
  const parsed = createSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: toFieldErrors(parsed.error) };
}

/** Validates a PATCH /admin/announcements/:id body: a strict, nonempty subset of writable fields (D-80). */
export function parseAnnouncementPatchInput(input: unknown): Result<AnnouncementPatchInput, FieldErrors> {
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
