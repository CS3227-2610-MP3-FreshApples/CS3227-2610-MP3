import { beforeEach, describe, expect, it } from "vitest";

import type { RateLimiter, RateLimitKey, RateLimitPolicy } from "../../../src/server/services/rate-limit";

export interface RateLimiterHarness {
  readonly limiter: RateLimiter;
  /** A key the implementation counts from zero: a new key for PostgreSQL, a scripted one for the fail-closed fake. */
  freshKey(): RateLimitKey;
  /** The count stored for `key` in the current window of `policy`, or `null` when no row exists. */
  storedCount(key: RateLimitKey, policy: RateLimitPolicy): Promise<number | null>;
  /** Ends the current window of every key, so the next call falls in a new one. */
  startNextWindow(): Promise<void>;
}

// A day-long window keeps a natural window boundary from falling inside a test.
const DAY = { limit: 3, windowSeconds: 86_400 } as const satisfies RateLimitPolicy;
const MINUTE = { limit: 1, windowSeconds: 60 } as const satisfies RateLimitPolicy;

/** A key that looks like sensitive data, to prove error messages never echo it (D-47). */
export const SENSITIVE_KEY_MARKER = "someone@example.test";

/**
 * K6 contract suite (workflow/contracts.md §9, §19 AM-07; D-43). Runs against the fail-closed fake, with
 * scripted keys, and the PostgreSQL implementation, so both admit, reject and throw on exactly the same calls.
 */
export function describeRateLimiterContract(label: string, setup: () => Promise<RateLimiterHarness>): void {
  describe(`RateLimiter contract — ${label}`, () => {
    let harness: RateLimiterHarness;
    let key: RateLimitKey;

    beforeEach(async () => {
      harness = await setup();
      key = harness.freshKey();
    });

    async function consumeTimes(times: number, policy: RateLimitPolicy): Promise<void> {
      for (let i = 0; i < times; i += 1) {
        expect(await harness.limiter.consume(key, policy, 1)).toEqual({ allowed: true });
      }
    }

    function expectRejection(outcome: unknown, windowSeconds: number): void {
      expect(outcome).toEqual({ allowed: false, retryAfterSeconds: expect.any(Number) });
      const { retryAfterSeconds } = outcome as { retryAfterSeconds: number };
      expect(Number.isInteger(retryAfterSeconds)).toBe(true);
      expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(retryAfterSeconds).toBeLessThanOrEqual(windowSeconds);
    }

    describe("consume", () => {
      it("admits the limit-th call and rejects the next", async () => {
        await consumeTimes(DAY.limit, DAY);

        expectRejection(await harness.limiter.consume(key, DAY, 1), DAY.windowSeconds);
        expect(await harness.storedCount(key, DAY)).toBe(DAY.limit);
      });

      it("does not increment on a rejected call", async () => {
        await consumeTimes(DAY.limit, DAY);

        for (let i = 0; i < 3; i += 1) {
          expectRejection(await harness.limiter.consume(key, DAY, 1), DAY.windowSeconds);
        }
        expect(await harness.storedCount(key, DAY)).toBe(DAY.limit);
      });

      it("admits when count + units equals the limit and rejects when it would exceed it", async () => {
        const policy = { limit: 5, windowSeconds: 86_400 };

        expect(await harness.limiter.consume(key, policy, 3)).toEqual({ allowed: true });
        expectRejection(await harness.limiter.consume(key, policy, 3), policy.windowSeconds);
        expect(await harness.storedCount(key, policy)).toBe(3);

        expect(await harness.limiter.consume(key, policy, 2)).toEqual({ allowed: true });
        expect(await harness.storedCount(key, policy)).toBe(5);
      });

      it("admits units equal to the limit on a fresh key", async () => {
        expect(await harness.limiter.consume(key, DAY, DAY.limit)).toEqual({ allowed: true });
        expect(await harness.storedCount(key, DAY)).toBe(DAY.limit);
      });

      it("returns retryAfterSeconds of at least 1 and within a short window", async () => {
        await consumeTimes(MINUTE.limit, MINUTE);

        expectRejection(await harness.limiter.consume(key, MINUTE, 1), MINUTE.windowSeconds);
      });

      it("admits again in a new window", async () => {
        await consumeTimes(DAY.limit, DAY);
        expectRejection(await harness.limiter.consume(key, DAY, 1), DAY.windowSeconds);

        await harness.startNextWindow();

        expect(await harness.limiter.consume(key, DAY, 1)).toEqual({ allowed: true });
        expect(await harness.storedCount(key, DAY)).toBe(1);
      });

      it("counts keys independently", async () => {
        const other = harness.freshKey();
        await consumeTimes(DAY.limit, DAY);

        expect(await harness.limiter.consume(other, DAY, 1)).toEqual({ allowed: true });
        expect(await harness.storedCount(other, DAY)).toBe(1);
      });
    });

    describe("check", () => {
      it("allows a fresh key and creates no row", async () => {
        expect(await harness.limiter.check(key, DAY)).toEqual({ allowed: true });
        expect(await harness.storedCount(key, DAY)).toBeNull();
      });

      it("allows while the count is below the limit, without consuming", async () => {
        await consumeTimes(DAY.limit - 1, DAY);

        expect(await harness.limiter.check(key, DAY)).toEqual({ allowed: true });
        expect(await harness.limiter.check(key, DAY)).toEqual({ allowed: true });
        expect(await harness.storedCount(key, DAY)).toBe(DAY.limit - 1);
      });

      it("rejects once the count reaches the limit, with a retry time within the window", async () => {
        await consumeTimes(DAY.limit, DAY);

        expectRejection(await harness.limiter.check(key, DAY), DAY.windowSeconds);
        expect(await harness.storedCount(key, DAY)).toBe(DAY.limit);
      });
    });

    describe("input validity (D-43)", () => {
      const invalidPolicies: readonly [string, RateLimitPolicy][] = [
        ["a zero limit", { limit: 0, windowSeconds: 60 }],
        ["a negative limit", { limit: -1, windowSeconds: 60 }],
        ["a fractional limit", { limit: 1.5, windowSeconds: 60 }],
        ["a NaN limit", { limit: Number.NaN, windowSeconds: 60 }],
        ["a zero window", { limit: 1, windowSeconds: 0 }],
        ["a negative window", { limit: 1, windowSeconds: -60 }],
        ["a fractional window", { limit: 1, windowSeconds: 1.5 }],
        ["a window above 86,400 seconds", { limit: 1, windowSeconds: 86_401 }],
        ["an infinite window", { limit: 1, windowSeconds: Number.POSITIVE_INFINITY }],
      ];

      it.each(invalidPolicies)("consume throws on %s and stores nothing", async (_, policy) => {
        await expect(harness.limiter.consume(key, policy, 1)).rejects.toThrow("invalid rate-limit policy");
        expect(await harness.storedCount(key, { limit: 1, windowSeconds: 60 })).toBeNull();
      });

      it.each(invalidPolicies)("check throws on %s", async (_, policy) => {
        await expect(harness.limiter.check(key, policy)).rejects.toThrow("invalid rate-limit policy");
      });

      it.each([
        ["zero units", 0],
        ["negative units", -1],
        ["fractional units", 0.5],
        ["NaN units", Number.NaN],
      ])("consume throws on %s", async (_, units) => {
        await expect(harness.limiter.consume(key, DAY, units)).rejects.toThrow("invalid rate-limit units");
        expect(await harness.storedCount(key, DAY)).toBeNull();
      });

      it("throws instead of returning a retry time when units exceed the limit", async () => {
        await expect(harness.limiter.consume(key, DAY, DAY.limit + 1)).rejects.toThrow("invalid rate-limit units");
        expect(await harness.storedCount(key, DAY)).toBeNull();
      });

      it("accepts a window of exactly 86,400 seconds", async () => {
        expect(await harness.limiter.consume(key, { limit: 1, windowSeconds: 86_400 }, 1)).toEqual({ allowed: true });
      });

      it("does not echo the key in an error message", async () => {
        const sensitive = `review_mutation:email:${SENSITIVE_KEY_MARKER}` as RateLimitKey;
        await expect(harness.limiter.consume(sensitive, DAY, DAY.limit + 1)).rejects.toThrow(
          expect.objectContaining({ message: expect.not.stringContaining(SENSITIVE_KEY_MARKER) }),
        );
      });
    });
  });
}
