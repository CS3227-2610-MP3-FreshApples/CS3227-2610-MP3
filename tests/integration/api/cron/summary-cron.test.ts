import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));
// connection() throws outside a Next.js request scope; here every call is a request, so it resolves.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

import { connectAsOwner } from "../../database/schema-fixtures";
import { testDatabaseUrl } from "../../database/test-database";

// GET /api/v1/internal/cron/summaries through the composition root (DEP-09, AT-20, D-89, D-98). Review rows are
// synthetic stand-ins for U-02 (D-91). Synthetic placeholder values only; none of these are real credentials.

const CRON_SECRET = "synthetic-cron-secret-0123456789abcdef0123";
const URL = "http://localhost:3000/api/v1/internal/cron/summaries";
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
  return import("../../../../src/app/api/v1/internal/cron/summaries/route");
}

function cronRequest(headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request(URL, { method, headers });
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
    `TRUNCATE app.review_summary, app.ai_budget_reservation, app.ai_job, app.ai_budget_day, app.scheduler_lease,
       app.rate_limit_window, app.review, app.movie, app.account CASCADE`,
  );
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A pending Movie with 3 eligible synthetic Reviews that the marker fake summarises. */
async function seedDueMovie(): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app.movie (title, synopsis, director, summary_pending_since)
     VALUES ('Synthetic Movie', 'Synthetic synopsis.', '', now() - interval '1 hour') RETURNING id`,
  );
  const movieId = rows[0]!.id;
  await owner.query(
    `WITH authors AS (
       INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
       SELECT gen_random_uuid() || '@example.test', 'synthetic-hash', 'Synthetic', 'USER', 'active'
       FROM generate_series(1, 3)
       RETURNING id
     )
     INSERT INTO app.review (movie_id, author_id, rating, body, moderation_state, clearance_source)
     SELECT $1, id, 8, 'A synthetic opinion. [fake-llm:summary]', 'cleared', 'ai' FROM authors`,
    [movieId],
  );
  return movieId;
}

/** Everything the sweep could write. */
async function writes(): Promise<Record<string, unknown>> {
  const { rows } = await owner.query(
    `SELECT (SELECT count(*)::integer FROM app.ai_job) AS jobs,
            (SELECT count(*)::integer FROM app.review_summary) AS summaries,
            (SELECT count(*)::integer FROM app.scheduler_lease) AS leases,
            (SELECT count(*)::integer FROM app.movie WHERE summary_last_attempt_at IS NOT NULL) AS attempted`,
  );
  return rows[0] as Record<string, unknown>;
}

const NO_WRITES = { jobs: 0, summaries: 0, leases: 0, attempted: 0 };

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toMatch(REQUEST_ID_PATTERN);
  expect(await response.json()).toEqual({ error: { code, message: expect.any(String), requestId } });
}

describe("GET /api/v1/internal/cron/summaries authorization (AT-20, D-98)", () => {
  it.each<[string, Record<string, string>]>([
    ["no Authorization header", {}],
    ["a wrong secret", { authorization: "Bearer synthetic-wrong-secret-0123456789abcdef" }],
    ["the Basic scheme", { authorization: `Basic ${CRON_SECRET}` }],
    ["an empty bearer credential", { authorization: "Bearer " }],
    ["extra credentials", { authorization: `Bearer ${CRON_SECRET} extra` }],
    ["an Admin session cookie alone", { cookie: "fa_session=synthetic-admin-session" }],
  ])("rejects %s with 401 before any scheduling work", async (_label, headers) => {
    await seedDueMovie();
    const { GET } = await routeWith(env(AI_WITH_MARKER_FAKE));

    await expectError(await GET(cronRequest(headers)), 401, "unauthenticated");
    expect(await writes()).toEqual(NO_WRITES);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"event":"access.denied"'));
  });

  it.each<[string, Record<string, string>]>([
    ["no Authorization header", {}],
    ["an empty bearer credential", { authorization: "Bearer " }],
    ["a bare Bearer scheme", { authorization: "Bearer" }],
  ])("rejects %s with 401 when CRON_SECRET is not configured (D-28)", async (_label, headers) => {
    await seedDueMovie();
    const { GET } = await routeWith(env({ ...AI_WITH_MARKER_FAKE, CRON_SECRET: "" }));

    await expectError(await GET(cronRequest(headers)), 401, "unauthenticated");
    expect(await writes()).toEqual(NO_WRITES);
  });

  it("returns 503 before checking the secret when core configuration is invalid (D-98 MD-1)", async () => {
    const { GET } = await routeWith(env({ SESSION_SECRET: "too-short" }));
    await expectError(await GET(cronRequest({ authorization: `Bearer ${CRON_SECRET}` })), 503, "service_unavailable");
  });
});

describe("GET /api/v1/internal/cron/summaries sweep (DEP-09, D-89)", () => {
  it("returns exactly the four zero counts with no writes when AI is disabled", async () => {
    await seedDueMovie();
    const { GET } = await routeWith(env());

    const response = await GET(cronRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(REQUEST_ID_PATTERN);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ processed: 0, skipped: 0, deferred: 0, failed: 0 });
    expect(await writes()).toEqual(NO_WRITES);
  });

  it("publishes one due Movie through the composition root and then has nothing due", async () => {
    const movieId = await seedDueMovie();
    const { GET } = await routeWith(env(AI_WITH_MARKER_FAKE));

    const first = await GET(cronRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ processed: 1, skipped: 0, deferred: 0, failed: 0 });
    const { rows } = await owner.query(
      "SELECT summary_pending_since IS NULL AS cleared FROM app.movie WHERE id = $1",
      [movieId],
    );
    expect(rows).toEqual([{ cleared: true }]);

    const second = await GET(cronRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(await second.json()).toEqual({ processed: 0, skipped: 0, deferred: 0, failed: 0 });
    expect(await writes()).toMatchObject({ jobs: 1, summaries: 1 });

    // One summary.sweep line per run, holding no Review text or output (D-94 L8).
    const lines = vi.mocked(console.info).mock.calls.map(([line]) => String(line)).filter((line) => line.includes('"summary.sweep"'));
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ outcome: "completed", movieId, outcomeKind: "published" });
    for (const line of lines) {
      expect(line).not.toContain("synthetic opinion");
      expect(line).not.toContain("overall");
    }
  });

  it("exports GET only, so the framework answers other methods", async () => {
    const route = await routeWith(env());
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["GET"]);
  });
});
