import "server-only";

import { z } from "zod";

import type { FieldErrors, Result } from "../../shared";

export interface AdminUserStatusInput {
  readonly status: "active" | "suspended";
  readonly reason: string;
}

const schema = z.strictObject({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().refine((value) => Array.from(value).length >= 10 && Array.from(value).length <= 1_000, {
    message: "must be 10 to 1,000 characters",
  }),
});

export function parseAdminUserStatusInput(input: unknown): Result<AdminUserStatusInput, FieldErrors> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) fieldErrors[key] = ["unrecognized key"];
      continue;
    }
    const key = issue.path[0];
    if (typeof key === "string") fieldErrors[key] = [issue.code === "custom" ? issue.message : "invalid value"];
    else fieldErrors.request = ["must be a JSON object"];
  }
  return { ok: false, error: fieldErrors };
}
