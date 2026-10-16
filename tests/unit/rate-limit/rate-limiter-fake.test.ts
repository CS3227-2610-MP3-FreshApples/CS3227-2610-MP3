import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { RateLimitKey } from "../../../src/server/services/rate-limit";
import { describeRateLimiterContract } from "../../support/contracts/rate-limiter.contract";
import { createFailClosedRateLimiter, UNSCRIPTED_OUTCOME } from "../../support/fakes/rate-limiter";

const POLICY = { limit: 5, windowSeconds: 900 };

function newKey(): RateLimitKey {
  return `review_mutation:account:${randomUUID()}` as RateLimitKey;
}

describeRateLimiterContract("fail-closed fake (scripted keys)", async () => {
  const limiter = createFailClosedRateLimiter();
  return {
    limiter,
    freshKey: () => {
      const key = newKey();
      limiter.admit(key);
      return key;
    },
    storedCount: async (key) => limiter.storedCount(key),
    startNextWindow: async () => limiter.startNextWindow(),
  };
});

describe("fail-closed fake — unscripted keys", () => {
  it("rejects consume with a 60-second retry and counts nothing", async () => {
    const limiter = createFailClosedRateLimiter();
    const key = newKey();

    expect(await limiter.consume(key, POLICY, 1)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(limiter.storedCount(key)).toBeNull();
  });

  it("rejects check with a 60-second retry", async () => {
    const limiter = createFailClosedRateLimiter();

    expect(await limiter.check(newKey(), POLICY)).toEqual(UNSCRIPTED_OUTCOME);
  });

  it("does not admit a key scripted on another fake", async () => {
    const scripted = createFailClosedRateLimiter();
    const other = createFailClosedRateLimiter();
    const key = newKey();
    scripted.admit(key);

    expect(await other.consume(key, POLICY, 1)).toEqual(UNSCRIPTED_OUTCOME);
  });

  it("still throws on invalid input", async () => {
    const limiter = createFailClosedRateLimiter();

    await expect(limiter.consume(newKey(), POLICY, POLICY.limit + 1)).rejects.toThrow("invalid rate-limit units");
  });
});

describe("fail-closed fake — recording", () => {
  it("records every validated consume, admitted or not, in call order", async () => {
    const limiter = createFailClosedRateLimiter();
    const admitted = newKey();
    const unscripted = newKey();
    limiter.admit(admitted);

    await limiter.consume(admitted, POLICY, 1);
    await limiter.consume(unscripted, POLICY, 1);
    await expect(limiter.consume(admitted, POLICY, 0)).rejects.toThrow();

    expect(limiter.consumed).toEqual([
      { key: admitted, units: 1 },
      { key: unscripted, units: 1 },
    ]);
  });

  it("counts purge calls and deletes nothing", async () => {
    const limiter = createFailClosedRateLimiter();

    expect(await limiter.purgeExpired()).toBe(0);
    expect(limiter.purgeCalls).toBe(1);
  });
});
