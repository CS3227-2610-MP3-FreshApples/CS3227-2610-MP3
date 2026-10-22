import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { testDatabaseUrl } from "../../database/test-database";

// GET /api/v1/ai/jobs/:id through the composition root (api.md, D-102). Synthetic values only.

process.env.APP_ENV = "test";
process.env.PUBLIC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = "synthetic-session-secret-012345678901234567890123456789";
process.env.RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-012345678901234567890123456789";
process.env.AI_ENABLED = "false";
delete process.env.DATABASE_CA_CERT;

const { GET: getCsrf } = await import("../../../../src/app/api/v1/auth/csrf/route");
const { POST: register } = await import("../../../../src/app/api/v1/auth/register/route");
const { POST: login } = await import("../../../../src/app/api/v1/auth/login/route");
const jobRoute = await import("../../../../src/app/api/v1/ai/jobs/[id]/route");
const composition = await import("../../../../src/server/composition");
const { connectAsOwner } = await import("../../database/schema-fixtures");
const { seedReview } = await import("../../ai/moderation/fixtures");

const ORIGIN = "http://localhost:3000";
const ADMIN_EMAIL = "jobs-admin@example.test";
const ADMIN_PASSWORD = "Admin-password1!";
const USER_EMAIL = "jobs-user@example.test";
const USER_PASSWORD = "User-password1!";
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OUTPUT = {
  assessment: "uncertain",
  explanation: "Private explanation that Admins see only in the review queue.",
  matches: [],
  limitations: ["Human review is required."],
};

let owner: Client;
let adminSession: string;
let userSession: string;

function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function cookieValue(response: Response, name: string): string {
  const match = (response.headers.get("set-cookie") ?? "").match(new RegExp(`${name}=([^;]*)`));
  if (match?.[1] === undefined || match[1] === "") throw new Error(`missing ${name} cookie`);
  return match[1];
}

async function anonymousHeaders(): Promise<Record<string, string>> {
  const anonymous = await getCsrf(request("/api/v1/auth/csrf"));
  return {
    "content-type": "application/json",
    origin: ORIGIN,
    cookie: `fa_presession=${cookieValue(anonymous, "fa_presession")}`,
    "x-csrf-token": (await anonymous.json()).csrfToken as string,
  };
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await login(
    request("/api/v1/auth/login", {
      method: "POST",
      headers: await anonymousHeaders(),
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(response.status).toBe(200);
  return cookieValue(response, "fa_session");
}

function readJob(id: string, session: string | null): Promise<Response> {
  return jobRoute.GET(
    request(`/api/v1/ai/jobs/${id}`, { headers: session === null ? {} : { cookie: `fa_session=${session}` } }),
    { params: Promise.resolve({ id }) },
  );
}

/** One AIJob row as K10 would leave it, with `leaseSeconds` from now. */
async function insertJob(job: {
  readonly type: "review_moderation" | "summary";
  readonly subjectId: string;
  readonly status: "running" | "succeeded" | "failed" | "stale";
  readonly errorCode?: string | null;
  readonly leaseSeconds?: number;
}): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app.ai_job (type, trigger, subject_id, input_revision, dedup_key, status, attempt_count, lease_until,
                             expires_at, model_id, prompt_version, policy_version, input_hash,
                             bounded_input_snapshot, error_code)
     VALUES ($1, 'scheduler', $2, 1, $3, $4, 1, now() + make_interval(secs => $5), now() + interval '7 days',
             'fake-model', 'synthetic-prompt-v1', 'profanity-policy-v1', 'synthetic-input-hash',
             '{"reviewId": "synthetic", "capturedVersion": 1}'::jsonb, $6)
     RETURNING id`,
    [job.type, job.subjectId, randomUUID(), job.status, job.leaseSeconds ?? 90, job.errorCode ?? null],
  );
  return rows[0]!.id;
}

async function jobCount(): Promise<number> {
  const { rows } = await owner.query<{ n: number }>("SELECT count(*)::integer AS n FROM app.ai_job");
  return rows[0]!.n;
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toMatch(REQUEST_ID_PATTERN);
  expect(await response.json()).toEqual({ error: { code, message: expect.any(String), requestId } });
}

beforeAll(async () => {
  owner = await connectAsOwner();
  await composition.firstAdminBootstrapService!.bootstrap({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    requestId: randomUUID() as never,
  });
  const registered = await register(
    request("/api/v1/auth/register", {
      method: "POST",
      headers: await anonymousHeaders(),
      body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD, displayName: "Jobs User" }),
    }),
  );
  expect(registered.status).toBe(201);
  adminSession = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  userSession = await signIn(USER_EMAIL, USER_PASSWORD);
});

afterAll(async () => {
  await owner.end();
});

beforeEach(async () => {
  await owner.query("TRUNCATE app.review_moderation, app.ai_budget_reservation, app.ai_job CASCADE");
});

describe("GET /api/v1/ai/jobs/:id access (D-102)", () => {
  it("rejects an anonymous caller with 401", async () => {
    const { reviewId } = await seedReview(owner);
    const id = await insertJob({ type: "review_moderation", subjectId: reviewId, status: "running" });

    await expectError(await readJob(id, null), 401, "unauthenticated");
  });

  it("rejects a User with 403", async () => {
    const { reviewId } = await seedReview(owner);
    const id = await insertJob({ type: "review_moderation", subjectId: reviewId, status: "running" });

    await expectError(await readJob(id, userSession), 403, "forbidden");
  });

  it("returns 404 for a summary job, so summary execution records stay internal", async () => {
    const { movieId } = await seedReview(owner);
    const id = await insertJob({ type: "summary", subjectId: movieId, status: "succeeded" });

    await expectError(await readJob(id, adminSession), 404, "not_found");
  });

  it("returns 404 for a malformed or unknown ID", async () => {
    await expectError(await readJob("not-a-uuid", adminSession), 404, "not_found");
    await expectError(await readJob(randomUUID(), adminSession), 404, "not_found");
  });
});

describe("GET /api/v1/ai/jobs/:id projection (D-102)", () => {
  it("returns the safe fields of a succeeded job with its assessment and nothing else", async () => {
    const { reviewId } = await seedReview(owner);
    const id = await insertJob({ type: "review_moderation", subjectId: reviewId, status: "succeeded" });
    await owner.query(
      `INSERT INTO app.review_moderation (job_id, review_id, content_revision, captured_review_version, model_id,
                                          prompt_version, policy_version, output_json, generated_at)
       VALUES ($1, $2, 1, 1, 'fake-model', 'synthetic-prompt-v1', 'profanity-policy-v1', $3::jsonb, now())`,
      [id, reviewId, JSON.stringify(OUTPUT)],
    );

    const response = await readJob(id, adminSession);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      id,
      reviewId,
      state: "succeeded",
      retryAfterSeconds: null,
      result: { assessment: "uncertain" },
      errorCode: null,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      updatedAt: expect.stringMatching(/Z$/),
    });
    const text = JSON.stringify(body);
    for (const hidden of ["Private explanation", "limitations", "snapshot", "synthetic-input-hash", "fake-model", "prompt"]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("returns a retry hint for a running job and no result", async () => {
    const { reviewId } = await seedReview(owner);
    const id = await insertJob({ type: "review_moderation", subjectId: reviewId, status: "running", leaseSeconds: 45 });

    const body = (await (await readJob(id, adminSession)).json()) as Record<string, unknown>;

    expect(body).toMatchObject({ state: "running", result: null, errorCode: null });
    expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(40);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(45);
  });

  it("returns at least 1 second for a running job whose lease has just passed", async () => {
    const { reviewId } = await seedReview(owner);
    const id = await insertJob({ type: "review_moderation", subjectId: reviewId, status: "running", leaseSeconds: -5 });

    expect(await (await readJob(id, adminSession)).json()).toMatchObject({ retryAfterSeconds: 1 });
  });

  it("returns the fixed error code of a failed job", async () => {
    const { reviewId } = await seedReview(owner);
    const id = await insertJob({
      type: "review_moderation",
      subjectId: reviewId,
      status: "failed",
      errorCode: "invalid_output",
    });

    expect(await (await readJob(id, adminSession)).json()).toMatchObject({
      state: "failed",
      retryAfterSeconds: null,
      result: null,
      errorCode: "invalid_output",
    });
  });

  it("never dispatches or writes work", async () => {
    const { reviewId } = await seedReview(owner);
    const id = await insertJob({ type: "review_moderation", subjectId: reviewId, status: "failed", errorCode: "provider_timeout" });
    const before = await jobCount();

    await readJob(id, adminSession);

    expect(await jobCount()).toBe(before);
    const { rows } = await owner.query("SELECT status, error_code FROM app.ai_job WHERE id = $1", [id]);
    expect(rows).toEqual([{ status: "failed", error_code: "provider_timeout" }]);
  });
});
