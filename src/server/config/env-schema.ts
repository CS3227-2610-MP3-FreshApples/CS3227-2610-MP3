import "server-only";

import { z } from "zod";

import type { ConfigIssue, EnvRecord } from "./types";

export const REQUIRED = "is required";

const MIN_SECRET_LENGTH = 32;

/** Copies only `names` out of `env`, treating empty strings as unset. */
export function pickVariables<K extends string>(env: EnvRecord, names: readonly K[]): Partial<Record<K, string>> {
  const picked: Partial<Record<K, string>> = {};
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") {
      picked[name] = value;
    }
  }
  return picked;
}

/** A decimal integer string parsed to a number within [min, max]. */
export function integerString(min: number, max: number = Number.MAX_SAFE_INTEGER) {
  const range = max === Number.MAX_SAFE_INTEGER ? `at least ${min}` : `from ${min} to ${max}`;
  return z
    .string({ error: REQUIRED })
    .regex(/^\d+$/, "must be a non-negative integer")
    .transform(Number)
    .refine((value) => value >= min && value <= max, `must be an integer ${range}`);
}

export function secretString() {
  return z.string({ error: REQUIRED }).min(MIN_SECRET_LENGTH, `must be at least ${MIN_SECRET_LENGTH} characters`);
}

export function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Maps zod issues to variable names and the schema's own messages, which never include input values. */
export function toIssues(error: z.ZodError): ConfigIssue[] {
  return error.issues.map((issue) => ({
    variable: String(issue.path[0] ?? "configuration"),
    message: issue.message,
  }));
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
