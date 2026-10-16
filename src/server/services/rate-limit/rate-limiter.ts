import "server-only";

import type { Database, Sql } from "../../db";
import { createRateLimitWindowRepository } from "../../repositories/rate-limit";
import { assertValidPolicy, assertValidUnits, LONGEST_FIXED_WINDOW_SECONDS } from "./policies";
import type { RateLimiter, RateLimitOutcome } from "./types";

/** D-45: rows deleted per purge call. */
const PURGE_BATCH_ROWS = 1_000;

function outcome(allowed: boolean, retryAfterSeconds: number): RateLimitOutcome {
  return allowed ? { allowed: true } : { allowed: false, retryAfterSeconds };
}

/**
 * K6 (workflow/contracts.md §9, §19 AM-07; D-43, D-45). Each operation runs in its own short Tx, so it must
 * be called with no Tx open; K1 throws on a nested transaction. A database failure throws (P-10).
 * Nothing here logs: keys may be derived from emails or IPs (D-47).
 */
export function createRateLimiter(deps: { database: Database; sql: Sql }): RateLimiter {
  const { database } = deps;
  const windows = createRateLimitWindowRepository({ sql: deps.sql });
  return {
    async consume(key, policy, units) {
      assertValidPolicy(policy);
      assertValidUnits(policy, units);
      const consumed = await database.withTransaction((tx) =>
        windows.consume(tx, key, policy.limit, policy.windowSeconds, units),
      );
      return outcome(consumed.admitted, consumed.retryAfterSeconds);
    },
    async check(key, policy) {
      assertValidPolicy(policy);
      const peeked = await database.withTransaction((tx) => windows.peek(tx, key, policy.windowSeconds));
      return outcome(peeked.count < policy.limit, peeked.retryAfterSeconds);
    },
    purgeExpired() {
      return database.withTransaction((tx) => windows.deleteExpired(tx, LONGEST_FIXED_WINDOW_SECONDS, PURGE_BATCH_ROWS));
    },
  };
}
