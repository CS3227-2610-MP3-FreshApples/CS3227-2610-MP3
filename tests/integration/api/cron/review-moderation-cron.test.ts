import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));
// connection() throws outside a Next.js request scope; here every call is a request, so it resolves.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

import { connectAsOwner } from "../../database/schema-fixtures";
import { testDatabaseUrl } from "../../database/test-database";
import { seedReview, seedWork, workRows } from "../../ai/moderation/fixtures";

// GET /api/v1/internal/cron/review-moderation through the composition root (DEP-10, AI-02, D-45, D-101).
// Synthetic placeholder values only; none of these are real credentials.

const CRON_SECRET = "synthetic-cron-secret-0123456789abcdef0123";
const URL = "http://localhost:3000/api/v1/internal/cron/review-moderation";
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUTHORIZED = { authorization: `Bearer ${CRON_SECRET}` };

function env(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    APP_ENV: "test",
    PUBLIC_APP_URL: "http://localhost:3000",
    DATABASE_URL: testDatabaseUrl(),
    DATABASE_CA_CERT: "",
    SESSION_SECRET: "synthetic-session-secret-0123456789abcdef",
    RATE_LIMIT_KEY_SECRET: "synthetic-rate-limit-secret-0123456789abcdef",
    SESSION_TTL_SECONDS: "",
    REPORT_SUSPENSION_THRESHOLD: "",
    CRON_SECRET,
    AI_ENABLED: "false",
    ...overrides,
  };
}

/** AI enabled with the marker fake (D-57), which `APP_ENV=test` permits. */
const AI_WITH_MARKER_FAKE: Record<string, string> = {
  AI_ENABLED: "true",
  AI_PROVIDER: "fake",
  SOC_LLM_BASE_URL: "https://llm.example.test",
  SOC_LLM_API_KEY: "synthetic-api-key",
  SOC_LLM_MODEL: "fake-model",
  SOC_LLM_REQUESTS_PER_MINUTE: "1000",
  AI_DAILY_BUDGET_MICRODOLLARS: "50000000",
  SOC_LLM_INPUT_PRICE_MICRODOLLARS_PER_MTOK: "411810",
  SOC_LLM_OUTPUT_PRICE_MICRODOLLARS_PER_MTOK: "1456571",
};

/** Loads the route against a fresh composition root built from `variables` (D-23: one per server instance). */
async function routeWith(variables: Record<string, string>): Promise<{ GET: (request: Request) => Promise<Response> }> {
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
  vi.resetModules();
  return import("../../../../src/app/api/v1/internal/cron/review-moderation/route");
}

function cronRequest(headers: Record<string, string> = {}): Request {
  return new Request(URL, { method: "GET", headers });
}

let owner: Client;

beforeAll(async () => {
  owner = await connectAsOwner();
});

afterAll(async () => {
  await owner.end();
});

beforeEach(async () => {
  await owner.query(
    `TRUNCATE app.audit_entry, app.review_moderation, app.moderation_work, app.ai_budget_reservation, app.ai_job,
       app.ai_budget_day, app.scheduler_lease, app.rate_limit_window, app.review, app.movie, app.account CASCADE`,
  );
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A pending Review whose due work the marker fake clears. */
async function seedDueReview(body = "A gentle film. [fake-llm:clean]") {
  const seeded = await seedReview(owner, { body });
  await seedWork(owner, seeded.reviewId);
  return seeded;
}

/** An expired RateLimitWindow row the D-45 purge deletes. */
async function seedExpiredWindow(): Promise<void> {
  await owner.query(
    `INSERT INTO app.rate_limit_window (bucket_key, window_start, count)
     VALUES ('synthetic-expired-bucket', now() - interval '2 hours', 1)`,
  );
}

async function expiredWindows(): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(
    "SELECT count(*)::integer AS n FROM app.rate_limit_window WHERE bucket_key = 'synthetic-expired-bucket'",
  );
  return rows[0]!.n;
}

async function writes(): Promise<Record<string, unknown>> {
  const { rows } = await owner.query(
    `SELECT (SELECT count(*)::integer FROM app.ai_job) AS jobs,
            (SELECT count(*)::integer FROM app.review_moderation) AS results,
            (SELECT count(*)::integer FROM app.scheduler_lease) AS leases,
            (SELECT count(*)::integer FROM app.moderation_work WHERE status <> 'pending') AS settled`,
  );
  return rows[0] as Record<string, unknown>;
}

const NO_WRITES = { jobs: 0, results: 0, leases: 0, settled: 0 };

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toMatch(REQUEST_ID_PATTERN);
  expect(await response.json()).toEqual({ error: { code, message: expect.any(String), requestId } });
}

describe("GET /api/v1/internal/cron/review-moderation authorization (DEP-10, D-101)", () => {
  it.each<[string, Record<string, string>]>([
    ["no Authorization header", {}],
    ["a wrong secret", { authorization: "Bearer synthetic-wrong-secret-0123456789abcdef" }],
    ["the Basic scheme", { authorization: `Basic ${CRON_SECRET}` }],
    ["an empty bearer credential", { authorization: "Bearer " }],
    ["an Admin session cookie alone", { cookie: "fa_session=synthetic-admin-session" }],
  ])("rejects %s with 401 before any work, including the purge", async (_label, headers) => {
    await seedDueReview();
    await seedExpiredWindow();
    const { GET } = await routeWith(env(AI_WITH_MARKER_FAKE));

    await expectError(await GET(cronRequest(headers)), 401, "unauthenticated");
    expect(await writes()).toEqual(NO_WRITES);
    expect(await expiredWindows()).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"event":"access.denied"'));
  });

  it("rejects every caller with 401 when CRON_SECRET is not configured (D-28)", async () => {
    await seedDueReview();
    const { GET } = await routeWith(env({ ...AI_WITH_MARKER_FAKE, CRON_SECRET: "" }));

    await expectError(await GET(cronRequest({ authorization: "Bearer " })), 401, "unauthenticated");
    await expectError(await GET(cronRequest()), 401, "unauthenticated");
    expect(await writes()).toEqual(NO_WRITES);
  });

  it("returns 503 before checking the secret when core configuration is invalid", async () => {
    const { GET } = await routeWith(env({ SESSION_SECRET: "too-short" }));

    await expectError(await GET(cronRequest(AUTHORIZED)), 503, "service_unavailable");
  });
});

describe("GET /api/v1/internal/cron/review-moderation sweep (DEP-10, D-45, D-101)", () => {
  it("purges expired rate-limit windows and returns zero counts with no AI writes when AI is disabled", async () => {
    await seedDueReview();
    await seedExpiredWindow();
    const { GET } = await routeWith(env());

    const response = await GET(cronRequest(AUTHORIZED));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(REQUEST_ID_PATTERN);
    expect(await response.json()).toEqual({ processed: 0, skipped: 0, deferred: 0, failed: 0 });
    expect(await writes()).toEqual(NO_WRITES);
    expect(await expiredWindows()).toBe(0);
  });

  it("screens one due Review through the composition root and then has nothing due", async () => {
    const { reviewId } = await seedDueReview();
    const { GET } = await routeWith(env(AI_WITH_MARKER_FAKE));

    const first = await GET(cronRequest(AUTHORIZED));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ processed: 1, skipped: 0, deferred: 0, failed: 0 });
    const { rows } = await owner.query("SELECT moderation_state FROM app.review WHERE id = $1", [reviewId]);
    expect(rows).toEqual([{ moderation_state: "cleared" }]);

    const second = await GET(cronRequest(AUTHORIZED));
    expect(await second.json()).toEqual({ processed: 0, skipped: 0, deferred: 0, failed: 0 });

    const lines = vi
      .mocked(console.info)
      .mock.calls.map(([line]) => String(line))
      .filter((line) => line.includes('"review_moderation.sweep"'));
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ outcome: "completed", reviewId, result: "cleared" });
    for (const line of lines) {
      expect(line).not.toContain("gentle film");
    }
  });

  it("never lets pending work of a hidden Review take the one-Review slot (D-54)", async () => {
    const hidden = await seedReview(owner, { hidden: true, body: "Hidden. [fake-llm:clean]" });
    await seedWork(owner, hidden.reviewId, { lastAttemptInSeconds: null });
    const visible = await seedDueReview();
    await owner.query("UPDATE app.moderation_work SET last_attempt_at = now() - interval '1 hour' WHERE review_id = $1", [
      visible.reviewId,
    ]);
    const { GET } = await routeWith(env(AI_WITH_MARKER_FAKE));

    expect(await (await GET(cronRequest(AUTHORIZED))).json()).toEqual({ processed: 1, skipped: 0, deferred: 0, failed: 0 });
    expect((await workRows(owner, hidden.reviewId))[0]!.status).toBe("pending");
    expect((await workRows(owner, visible.reviewId))[0]!.status).toBe("completed");
  });

  it("still sweeps when the purge fails, and logs rate_limit.purge_failed (D-45, D-47)", async () => {
    const { reviewId } = await seedDueReview();
    const route = await routeWith(env(AI_WITH_MARKER_FAKE));
    const composition = await import("../../../../src/server/composition");
    vi.spyOn(composition.rateLimiter!, "purgeExpired").mockRejectedValueOnce(new Error("purge fault"));

    const response = await route.GET(cronRequest(AUTHORIZED));

    expect(await response.json()).toEqual({ processed: 1, skipped: 0, deferred: 0, failed: 0 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"event":"rate_limit.purge_failed"'));
    expect((await workRows(owner, reviewId))[0]!.status).toBe("completed");
  });

  it("purges once per invocation", async () => {
    const route = await routeWith(env());
    const composition = await import("../../../../src/server/composition");
    const purge = vi.spyOn(composition.rateLimiter!, "purgeExpired");

    await route.GET(cronRequest(AUTHORIZED));

    expect(purge).toHaveBeenCalledTimes(1);
  });

  it("exports GET and maxDuration only, so the framework answers other methods", async () => {
    const route = (await routeWith(env())) as Record<string, unknown>;

    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["GET"]);
    expect(route.maxDuration).toBe(120);
  });
});
