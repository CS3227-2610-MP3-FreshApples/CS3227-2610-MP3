import "server-only";

import { z } from "zod";

import { AUDIT_ACTIONS, AUDIT_RESULTS, AUDIT_TARGET_TYPES } from "./types";

const MAX_METADATA_KEYS = 20;
const MAX_VALUE_CODE_POINTS = 1_000;
const METADATA_KEY = /^[a-z][a-zA-Z0-9_]{0,63}$/;

/** D-46 forbidden key names, compared case-insensitively with underscores removed. Defence in depth only. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "password",
  "passwordhash",
  "token",
  "sessiontoken",
  "csrftoken",
  "secret",
  "email",
  "body",
  "explanation",
  "snapshot",
  "evidencesnapshot",
  "prompt",
  "response",
  "output",
]);

function isAllowedKey(key: string): boolean {
  return !FORBIDDEN_KEYS.has(key.replaceAll("_", "").toLowerCase());
}

function codePointCount(value: string): number {
  return [...value].length;
}

const metadataKey = z.string().regex(METADATA_KEY).refine(isAllowedKey);

// z.number() rejects NaN and ±Infinity, so every accepted number is finite.
const metadataValue = z.union([
  z.string().refine((value) => codePointCount(value) <= MAX_VALUE_CODE_POINTS),
  z.number(),
  z.boolean(),
  z.null(),
]);

const auditEntrySchema = z.strictObject({
  actorId: z.uuid().nullable(),
  action: z.enum(AUDIT_ACTIONS),
  targetType: z.enum(AUDIT_TARGET_TYPES),
  targetId: z.uuid(),
  result: z.enum(AUDIT_RESULTS),
  metadata: z
    .record(metadataKey, metadataValue)
    .refine((metadata) => Object.keys(metadata).length <= MAX_METADATA_KEYS),
  requestId: z.uuid(),
});

export type ValidAuditEntry = z.infer<typeof auditEntrySchema>;

/**
 * Validates an audit entry against D-46. Throws a generic error on any violation, so the caller's Tx rolls
 * back; the message names no field or value, because metadata may hold what D-46 forbids.
 */
export function parseAuditEntry(entry: unknown): ValidAuditEntry {
  const parsed = auditEntrySchema.safeParse(entry);
  if (!parsed.success) {
    throw new Error("invalid audit entry");
  }
  return parsed.data;
}
