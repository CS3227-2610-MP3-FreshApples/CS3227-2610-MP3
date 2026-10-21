import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { testDatabaseUrl } from "../../database/test-database";
process.env.APP_ENV = "test";
process.env.PUBLIC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = "synthetic-session-secret-012345678901234567890123456789";
process.env.RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-012345678901234567890123456789";
process.env.AI_ENABLED = "false";
delete process.env.DATABASE_CA_CERT;

const route = await import("../../../../src/app/api/v1/movies/[id]/summary/route");
const { MARKER_FAKE_SUMMARY_OUTPUT } = await import("../../../../src/server/adapters/soc-llm/marker-fake-provider");
const { connectAsOwner, insertMovie } = await import("../../database/schema-fixtures");

// GET /api/v1/movies/:id/summary (FR-08, AT-07, D-90, D-98). Review rows are synthetic stand-ins for U-02 (D-91).
// Synthetic placeholder values only.

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function get(id: string, headers: Record<string, string> = {}): Promise<Response> {
  return route.GET(new Request(`http://localhost:3000/api/v1/movies/${id}/summary`, { headers }), {
    params: Promise.resolve({ id }),
  });
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
});

async function seedReviews(movieId: string, count: number): Promise<void> {
  await owner.query(
    `WITH authors AS (
       INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
       SELECT gen_random_uuid() || '@example.test', 'synthetic-hash', 'Synthetic', 'USER', 'active'
       FROM generate_series(1, $2::integer)
       RETURNING id
     )
     INSERT INTO app.review (movie_id, author_id, rating, body, moderation_state, clearance_source)
     SELECT $1, id, 9, 'Synthetic review body.', 'cleared', 'ai' FROM authors`,
    [movieId, count],
  );
}

async function insertCurrentSummary(movieId: string): Promise<void> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app.ai_job (type, trigger, subject_id, input_revision, dedup_key, status, lease_until, expires_at,
                             model_id, prompt_version, input_hash)
     SELECT 'summary', 'scheduler', id, reviews_revision, $2, 'succeeded', now(), now() + interval '7 days',
            'synthetic-model', 'review-summary-prompt-v1', 'synthetic-hash'
     FROM app.movie WHERE id = $1 RETURNING id`,
    [movieId, randomUUID()],
  );
  const sample = {
    algorithm: "summary-sample-v1",
    seed: "ef".repeat(32),
    sampledCount: 3,
    reviews: Array.from({ length: 3 }, () => ({ reviewId: randomUUID(), version: 1, contentRevision: 1, truncated: false })),
  };
  await owner.query(
    `INSERT INTO app.review_summary
       (job_id, movie_id, reviews_revision, sampled_review_ids_and_versions, eligible_count, output_json, generated_at)
     SELECT $1, id, reviews_revision, $3::jsonb, 3, $4::jsonb, now() FROM app.movie WHERE id = $2`,
    [rows[0]!.id, movieId, JSON.stringify(sample), MARKER_FAKE_SUMMARY_OUTPUT],
  );
}

async function expectNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toMatch(REQUEST_ID_PATTERN);
  expect(await response.json()).toEqual({ error: { code: "not_found", message: expect.any(String), requestId } });
}

describe("GET /api/v1/movies/:id/summary (FR-08, D-90)", () => {
  it("returns exactly the D-90 ready shape to an anonymous caller, with no-store and no cookie", async () => {
    const movieId = await insertMovie(owner);
    await seedReviews(movieId, 3);
    await insertCurrentSummary(movieId);

    const response = await get(movieId);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(REQUEST_ID_PATTERN);
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["eligibleCount", "status", "summary"]);
    expect(Object.keys(body.summary).sort()).toEqual(
      ["criticisms", "generatedAt", "includedCount", "mixedOpinions", "overall", "strengths", "truncated"],
    );
    expect(body).toMatchObject({ status: "ready", eligibleCount: 3, summary: { includedCount: 3, truncated: false } });
    expect(body.summary.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    for (const item of [...body.summary.strengths, ...body.summary.criticisms, ...body.summary.mixedOpinions]) {
      expect(Object.keys(item)).toEqual(["text"]);
    }
    const text = JSON.stringify(body);
    for (const hidden of ["sources", "R1", "seed", "jobId", "synthetic-model", "review-summary-prompt"]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("returns the same body whatever session cookie the caller sends", async () => {
    const movieId = await insertMovie(owner);
    await seedReviews(movieId, 3);
    await insertCurrentSummary(movieId);

    const anonymous = await (await get(movieId)).json();
    const withCookie = await (await get(movieId, { cookie: "fa_session=synthetic-session" })).json();
    expect(withCookie).toEqual(anonymous);
  });

  it("returns insufficient_reviews without a summary key for fewer than 3 eligible Reviews", async () => {
    const movieId = await insertMovie(owner);
    await seedReviews(movieId, 2);
    const response = await get(movieId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "insufficient_reviews", eligibleCount: 2 });
  });

  it("returns missing for a Movie with enough Reviews and no summary", async () => {
    const movieId = await insertMovie(owner);
    await seedReviews(movieId, 3);
    expect(await (await get(movieId)).json()).toEqual({ status: "missing", eligibleCount: 3 });
  });

  it("returns 404 for a malformed, unknown or archived Movie ID", async () => {
    const archived = await insertMovie(owner);
    await seedReviews(archived, 3);
    await insertCurrentSummary(archived);
    await owner.query("UPDATE app.movie SET archived_at = now() WHERE id = $1", [archived]);

    await expectNotFound(await get("not-a-uuid"));
    await expectNotFound(await get(randomUUID()));
    await expectNotFound(await get(archived));
  });

  it("starts no generation and writes nothing (AT-07)", async () => {
    const movieId = await insertMovie(owner);
    await seedReviews(movieId, 3);
    await owner.query("UPDATE app.movie SET summary_pending_since = now() WHERE id = $1", [movieId]);
    const before = (await owner.query("SELECT * FROM app.movie WHERE id = $1", [movieId])).rows;

    await get(movieId);
    await get(movieId);

    expect((await owner.query("SELECT * FROM app.movie WHERE id = $1", [movieId])).rows).toEqual(before);
    const { rows } = await owner.query(
      `SELECT (SELECT count(*)::integer FROM app.ai_job) AS jobs,
              (SELECT count(*)::integer FROM app.scheduler_lease) AS leases,
              (SELECT count(*)::integer FROM app.ai_budget_reservation) AS reservations`,
    );
    expect(rows[0]).toEqual({ jobs: 0, leases: 0, reservations: 0 });
  });

  it("exports GET only: there is no summary POST (AT-07)", () => {
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["GET"]);
    expect(route.maxDuration).toBe(15);
  });
});
