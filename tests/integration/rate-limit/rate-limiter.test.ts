import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import {
  createRateLimiter,
  createRateLimitKeys,
  RATE_LIMIT_POLICIES,
  type RateLimiter,
  type RateLimitKey,
  type RateLimitPolicy,
} from "../../../src/server/services/rate-limit";
import { createLoginRole, dropLoginRole } from "../../setup/test-database.mjs";
import { describeRateLimiterContract } from "../../support/contracts/rate-limiter.contract";
import { connectAsOwner } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";

// A per-file login role that inherits exactly app_runtime's privileges (D-31, D-32), so every limiter
// statement runs with production's table privileges. Generated per run; never recorded.
const RUNTIME_ROLE = `mp3_rate_limit_${randomBytes(4).toString("hex")}`;
const RUNTIME_PASSWORD = randomBytes(24).toString("hex");

// Synthetic values only.
const SECRET = "synthetic-rate-limit-key-secret-0123456789";
const OTHER_SECRET = "synthetic-rate-limit-key-secret-9876543210";
const EMAIL = "someone@example.test";
const IP = "203.0.113.7";

const DAY: RateLimitPolicy = { limit: 10, windowSeconds: 86_400 };

let owner: Client;
/** Two pools of one connection each: two server instances competing for the same rows. */
let first: Database & Sql;
let second: Database & Sql;
let limiter: RateLimiter;
let limiterOnSecond: RateLimiter;

function runtimeUrl(): string {
  const url = new URL(testDatabaseUrl());
  url.username = RUNTIME_ROLE;
  url.password = RUNTIME_PASSWORD;
  return url.href;
}

function newKey(): RateLimitKey {
  return `review_mutation:account:${randomUUID()}` as RateLimitKey;
}

beforeAll(async () => {
  owner = await connectAsOwner();
  await createLoginRole(owner, RUNTIME_ROLE, RUNTIME_PASSWORD);
  first = createDatabase({ url: runtimeUrl(), caCert: null });
  second = createDatabase({ url: runtimeUrl(), caCert: null });
  limiter = createRateLimiter({ database: first, sql: first });
  limiterOnSecond = createRateLimiter({ database: second, sql: second });
});

afterAll(async () => {
  // The pools have no close operation, so end their sessions before dropping the role.
  await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1", [RUNTIME_ROLE]);
  await dropLoginRole(owner, RUNTIME_ROLE);
  await owner.end();
});

async function truncate(): Promise<void> {
  await owner.query("TRUNCATE app.rate_limit_window");
}

async function storedCount(key: RateLimitKey, policy: RateLimitPolicy): Promise<number | null> {
  const { rows } = await owner.query<{ count: number }>(
    `SELECT count FROM app.rate_limit_window
     WHERE bucket_key = $1
       AND window_start = to_timestamp(floor(extract(epoch FROM now()) / $2::integer) * $2::integer)`,
    [key, policy.windowSeconds],
  );
  return rows[0]?.count ?? null;
}

async function bucketKeys(): Promise<string[]> {
  const { rows } = await owner.query<{ bucket_key: string }>(
    "SELECT bucket_key FROM app.rate_limit_window ORDER BY bucket_key",
  );
  return rows.map((row) => row.bucket_key);
}

describeRateLimiterContract("PostgreSQL", async () => {
  await truncate();
  return {
    limiter,
    freshKey: newKey,
    storedCount,
    // Moving every stored row back two days leaves the current window of every key empty.
    startNextWindow: async () => {
      await owner.query("UPDATE app.rate_limit_window SET window_start = window_start - interval '2 days'");
    },
  };
});

describe("RateLimiter — PostgreSQL concurrency (D-43 atomicity)", () => {
  beforeEach(truncate);

  it("admits exactly N of 2N parallel calls from two pool clients", async () => {
    const keys = Array.from({ length: 5 }, newKey);

    const outcomes = await Promise.all(
      keys.map((key) =>
        Promise.all(
          Array.from({ length: 2 * DAY.limit }, (_, i) => (i % 2 === 0 ? limiter : limiterOnSecond).consume(key, DAY, 1)),
        ),
      ),
    );

    for (const [index, key] of keys.entries()) {
      expect(outcomes[index]!.filter((outcome) => outcome.allowed)).toHaveLength(DAY.limit);
      expect(await storedCount(key, DAY)).toBe(DAY.limit);
    }
  });

  it("admits exactly N units when multi-unit calls compete", async () => {
    const key = newKey();
    const policy = { limit: 9, windowSeconds: 86_400 };

    const outcomes = await Promise.all(
      Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? limiter : limiterOnSecond).consume(key, policy, 3)),
    );

    expect(outcomes.filter((outcome) => outcome.allowed)).toHaveLength(3);
    expect(await storedCount(key, policy)).toBe(9);
  });
});

describe("RateLimiter — PostgreSQL clock and windows", () => {
  beforeEach(truncate);

  it.each([7, 60, 86_400])("stores an epoch-aligned window_start from the database clock (%i s)", async (windowSeconds) => {
    const key = newKey();
    await limiter.consume(key, { limit: 1, windowSeconds }, 1);

    const { rows } = await owner.query<{ start: string; now: string }>(
      `SELECT extract(epoch FROM window_start)::text AS start, extract(epoch FROM now())::text AS now
       FROM app.rate_limit_window WHERE bucket_key = $1`,
      [key],
    );
    expect(rows).toHaveLength(1);
    const start = Number(rows[0]!.start);
    expect(start % windowSeconds).toBe(0);
    expect(start).toBeLessThanOrEqual(Number(rows[0]!.now));
    expect(start).toBeGreaterThan(Number(rows[0]!.now) - 2 * windowSeconds);
  });

  it("computes retryAfterSeconds as the ceiling of window end minus the database now()", async () => {
    const key = newKey();
    const policy = { limit: 1, windowSeconds: 86_400 };
    await limiter.consume(key, policy, 1);

    const outcome = await limiter.consume(key, policy, 1);
    const { rows } = await owner.query<{ expected: number }>(
      "SELECT ceil(86400 - mod(extract(epoch FROM now()), 86400))::integer AS expected",
    );

    expect(outcome.allowed).toBe(false);
    const retryAfterSeconds = (outcome as { retryAfterSeconds: number }).retryAfterSeconds;
    expect(Math.abs(retryAfterSeconds - rows[0]!.expected)).toBeLessThanOrEqual(1);
  });

  it("admits again once the retry time has passed on the real clock", async () => {
    const key = newKey();
    const policy = { limit: 1, windowSeconds: 2 };

    // A natural window boundary can fall between calls, so consume until the window is full.
    let outcome = await limiter.consume(key, policy, 1);
    for (let attempt = 0; attempt < 3 && outcome.allowed; attempt += 1) {
      outcome = await limiter.consume(key, policy, 1);
    }
    expect(outcome.allowed).toBe(false);
    const retryAfterSeconds = (outcome as { retryAfterSeconds: number }).retryAfterSeconds;
    expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(retryAfterSeconds).toBeLessThanOrEqual(policy.windowSeconds);

    await sleep(retryAfterSeconds * 1_000 + 250);

    expect(await limiter.consume(key, policy, 1)).toEqual({ allowed: true });
  });
});

describe("RateLimiter — PostgreSQL transactions and failures", () => {
  beforeEach(truncate);

  it("throws when called inside an open transaction, and stores nothing", async () => {
    const key = newKey();

    await expect(first.withTransaction(() => limiter.consume(key, DAY, 1))).rejects.toThrow(
      "nested withTransaction",
    );
    expect(await bucketKeys()).toEqual([]);
  });

  it("commits its own transaction, visible to another connection at once", async () => {
    const key = newKey();
    await limiter.consume(key, DAY, 1);

    expect(await limiterOnSecond.check(key, { limit: 1, windowSeconds: DAY.windowSeconds })).toMatchObject({
      allowed: false,
    });
  });

  it("fails closed: every operation throws when the database is unavailable (P-10)", async () => {
    const missing = new URL(runtimeUrl());
    missing.pathname = `/mp3_missing_${randomBytes(4).toString("hex")}`;
    const unavailable = createDatabase({ url: missing.href, caCert: null });
    const failing = createRateLimiter({ database: unavailable, sql: unavailable });

    await expect(failing.consume(newKey(), DAY, 1)).rejects.toThrow();
    await expect(failing.check(newKey(), DAY)).rejects.toThrow();
    await expect(failing.purgeExpired()).rejects.toThrow();
  });
});

describe("RateLimiter — PostgreSQL purge (D-45)", () => {
  beforeEach(truncate);

  async function insertRow(key: string, ageSeconds: number): Promise<void> {
    await owner.query(
      "INSERT INTO app.rate_limit_window (bucket_key, window_start, count) VALUES ($1, now() - make_interval(secs => $2), 1)",
      [key, ageSeconds],
    );
  }

  it("removes only rows older than the longest fixed window and returns how many", async () => {
    await insertRow("purge:expired-day", 86_400);
    await insertRow("purge:expired", 3_601);
    await insertRow("purge:kept-hour", 3_599);
    await insertRow("purge:kept-login", 901); // past the 900-second login window, within the longest
    await insertRow("purge:current", 0);

    expect(await limiter.purgeExpired()).toBe(2);
    expect(await bucketKeys()).toEqual(["purge:current", "purge:kept-hour", "purge:kept-login"]);
  });

  it("deletes at most 1,000 rows per call", async () => {
    await owner.query(
      `INSERT INTO app.rate_limit_window (bucket_key, window_start, count)
       SELECT 'purge:' || n, now() - interval '2 hours', 1 FROM generate_series(1, 1001) AS n`,
    );

    expect(await limiter.purgeExpired()).toBe(1_000);
    expect(await bucketKeys()).toHaveLength(1);
    expect(await limiter.purgeExpired()).toBe(1);
    expect(await limiter.purgeExpired()).toBe(0);
  });

  it("does not purge a live window the limiter is still counting", async () => {
    const key = newKey();
    await limiter.consume(key, RATE_LIMIT_POLICIES.report_create, 1);

    expect(await limiter.purgeExpired()).toBe(0);
    expect(await storedCount(key, RATE_LIMIT_POLICIES.report_create)).toBe(1);
  });
});

describe("RateLimiter — stored keys (D-12, D-44)", () => {
  beforeEach(truncate);

  it("stores an email key that is not the email and changes with the secret", async () => {
    const policy = RATE_LIMIT_POLICIES.login_failure_email;
    await limiter.consume(createRateLimitKeys({ secret: SECRET }).forEmail("login_failure_email", EMAIL), policy, 1);
    await limiter.consume(createRateLimitKeys({ secret: OTHER_SECRET }).forEmail("login_failure_email", EMAIL), policy, 1);

    const stored = await bucketKeys();
    expect(stored).toHaveLength(2);
    expect(new Set(stored).size).toBe(2);
    for (const key of stored) {
      expect(key).toMatch(/^login_failure_email:email:[0-9a-f]{64}$/);
      expect(key).not.toContain(EMAIL);
      expect(key).not.toContain("example");
    }
  });

  it("stores an IP key that is not the IP", async () => {
    await limiter.consume(
      createRateLimitKeys({ secret: SECRET }).forClientIp("login_failure_ip", IP),
      RATE_LIMIT_POLICIES.login_failure_ip,
      1,
    );

    const stored = await bucketKeys();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^login_failure_ip:ip:[0-9a-f]{64}$/);
    expect(stored[0]).not.toContain(IP);
  });
});
