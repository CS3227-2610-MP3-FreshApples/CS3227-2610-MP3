import "server-only";

import type { RateLimitName, RateLimitPolicy } from "./types";

type FixedRateLimitName = Exclude<RateLimitName, "soc_requests">;

function policy(limit: number, windowSeconds: number): RateLimitPolicy {
  return Object.freeze({ limit, windowSeconds });
}

/**
 * D-44 fixed policies, initial targets (ASM-10); changing one is a spec change. `soc_requests` is built by
 * AI execution from AI configuration (S-06).
 */
export const RATE_LIMIT_POLICIES: Readonly<Record<FixedRateLimitName, RateLimitPolicy>> = Object.freeze({
  login_failure_email: policy(5, 900),
  login_failure_ip: policy(5, 900),
  review_mutation: policy(10, 60),
  report_create: policy(5, 3_600),
});

/** D-45: rows whose window started this long ago have ended, because no fixed window is longer. */
export const LONGEST_FIXED_WINDOW_SECONDS: number = Math.max(
  ...Object.values(RATE_LIMIT_POLICIES).map((fixed) => fixed.windowSeconds),
);

const MAX_WINDOW_SECONDS = 86_400;

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

// Messages name the rule only. They never carry the key, which may be derived from an email or IP (D-47).

/** D-43: `limit` is a positive integer; `windowSeconds` a positive integer of at most 86,400. */
export function assertValidPolicy(policy: RateLimitPolicy): void {
  if (
    !isPositiveInteger(policy.limit) ||
    !isPositiveInteger(policy.windowSeconds) ||
    policy.windowSeconds > MAX_WINDOW_SECONDS
  ) {
    throw new Error("invalid rate-limit policy");
  }
}

/** D-43: `units` is a positive integer no greater than `limit`, which could never be admitted. */
export function assertValidUnits(policy: RateLimitPolicy, units: number): void {
  if (!isPositiveInteger(units) || units > policy.limit) {
    throw new Error("invalid rate-limit units");
  }
}
