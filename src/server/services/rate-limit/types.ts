import "server-only";

import type { AccountId, Brand } from "../../shared";

/** K6 limit names (workflow/contracts.md §9, §20 AM-11). Adding a value is a contract PR. */
export type RateLimitName = "login_failure_email" | "login_failure_ip" | "review_mutation" | "report_create" | "soc_requests";

/** A RateLimitWindow `bucket_key` (D-44). Built only by `RateLimitKeys`; never logged (D-47). */
export type RateLimitKey = Brand<string, "RateLimitKey">;

export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowSeconds: number;
}

export type RateLimitOutcome =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number }; // computed from window end

/**
 * K6 (workflow/contracts.md §9, §19 AM-07). Every operation runs in its own short Tx, so it must be called
 * with no Tx open (§1 rule 8). A database failure throws, which maps to 503: the limiter fails closed (P-10).
 */
export interface RateLimiter {
  /** Atomic upsert-increment of RateLimitWindow by `units` (1 for every current policy). A rejection does not increment. */
  consume(key: RateLimitKey, policy: RateLimitPolicy, units: number): Promise<RateLimitOutcome>;
  /** Read-only check (e.g. login before verifying a password): allowed when the count is below the limit. Creates no row. */
  check(key: RateLimitKey, policy: RateLimitPolicy): Promise<RateLimitOutcome>;
  /** Own short Tx; deletes at most 1,000 expired rows and returns how many it deleted (D-45). */
  purgeExpired(): Promise<number>;
}

/** Builds `<limit name>:<subject>` keys (D-44). Email and IP subjects are HMACs, never the raw value (D-12). */
export interface RateLimitKeys {
  forAccount(limit: RateLimitName, accountId: AccountId): RateLimitKey;
  /** `normalizedEmail` is already normalized by Identity. */
  forEmail(limit: RateLimitName, normalizedEmail: string): RateLimitKey;
  /** `ip` is already derived by the K2 client-IP resolver. */
  forClientIp(limit: RateLimitName, ip: string): RateLimitKey;
  /** SoC per-minute request quota. */
  forEnvironment(limit: RateLimitName): RateLimitKey;
}
