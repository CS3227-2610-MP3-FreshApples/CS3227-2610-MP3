import type { RateLimiter, RateLimitKey, RateLimitOutcome } from "../../../src/server/services/rate-limit";
import { assertValidPolicy, assertValidUnits } from "../../../src/server/services/rate-limit/policies";

/** What an unscripted key returns from `consume` and `check` (workflow/contracts.md §9). */
export const UNSCRIPTED_OUTCOME: RateLimitOutcome = Object.freeze({ allowed: false, retryAfterSeconds: 60 });

export interface FakeRateLimiter extends RateLimiter {
  /** Scripts `key` to be counted in memory against each call's policy, as PostgreSQL would within one window. */
  admit(key: RateLimitKey): void;
  /** Ends the current window of every scripted key. */
  startNextWindow(): void;
  /** The count of a scripted key in the current window, or `null` when it has none. */
  storedCount(key: RateLimitKey): number | null;
  /** Every validated `consume` call, admitted or not, in call order. */
  readonly consumed: readonly { readonly key: RateLimitKey; readonly units: number }[];
  /** How many times `purgeExpired` was called. */
  readonly purgeCalls: number;
}

/**
 * K6 fake (workflow/contracts.md §1 rule 6, §9). Fails closed: an unscripted key is rejected with a
 * 60-second retry by both `consume` and `check`. It validates input with the same D-43 rules as the real
 * limiter. A rejection carries the whole window as its retry time, because the fake has no clock.
 */
export function createFailClosedRateLimiter(): FakeRateLimiter {
  const counts = new Map<RateLimitKey, number>();
  const scripted = new Set<RateLimitKey>();
  const consumed: { key: RateLimitKey; units: number }[] = [];
  let purgeCalls = 0;

  return {
    consumed,
    get purgeCalls() {
      return purgeCalls;
    },
    admit(key) {
      scripted.add(key);
    },
    startNextWindow() {
      counts.clear();
    },
    storedCount(key) {
      return counts.get(key) ?? null;
    },
    async consume(key, policy, units) {
      assertValidPolicy(policy);
      assertValidUnits(policy, units);
      consumed.push({ key, units });
      if (!scripted.has(key)) {
        return UNSCRIPTED_OUTCOME;
      }
      const count = counts.get(key) ?? 0;
      if (count + units > policy.limit) {
        return { allowed: false, retryAfterSeconds: policy.windowSeconds };
      }
      counts.set(key, count + units);
      return { allowed: true };
    },
    async check(key, policy) {
      assertValidPolicy(policy);
      if (!scripted.has(key)) {
        return UNSCRIPTED_OUTCOME;
      }
      return (counts.get(key) ?? 0) < policy.limit
        ? { allowed: true }
        : { allowed: false, retryAfterSeconds: policy.windowSeconds };
    },
    async purgeExpired() {
      purgeCalls += 1;
      return 0;
    },
  };
}
