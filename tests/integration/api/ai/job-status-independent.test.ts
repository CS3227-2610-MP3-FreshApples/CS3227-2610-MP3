import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { testDatabaseUrl } from "../../database/test-database";

// Independent D-102 cases for GET /api/v1/ai/jobs/:id through the composition root: 200 in every job state
// (D-103 I1), no requester, model, prompt, policy or snapshot in the body, and no writes. Synthetic values only.

process.env.APP_ENV = "test";
process.env.PUBLIC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = "synthetic-session-secret-012345678901234567890123456789";
process.env.RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-012345678901234567890123456789";
process.env.AI_ENABLED = "false";
delete process.env.DATABASE_CA_CERT;

const { GET: getCsrf } = await import("../../../../src/app/api/v1/auth/csrf/route");
const { POST: login } = await import("../../../../src/app/api/v1/auth/login/route");
const jobRoute = await import("../../../../src/app/api/v1/ai/jobs/[id]/route");
const composition = await import("../../../../src/server/composition");
const { connectAsOwner } = await import("../../database/schema-fixtures");
const { seedReview } = await import("../../ai/moderation/fixtures");

const ORIGIN = "http://localhost:3000";
const ADMIN_EMAIL = "jobs-indep-admin@example.test";
const ADMIN_PASSWORD = "Admin-password1!";
const SNAPSHOT_CANARY = "SNAPSHOT-CANARY-91c2";
const POLICY_CANARY = "policy-canary-v9";
const PROMPT_CANARY = "prompt-canary-v9";
const MODEL_CANARY = "model-canary";
const HASH_CANARY = "hash-canary-77";

let owner: Client;
let adminSession: string;
let adminId: string;

function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function cookieValue(response: Response, name: string): string {
  const match = (response.headers.get("set-cookie") ?? "").match(new RegExp(`${name}=([^;]*)`));
  if (match?.[1] === undefined || match[1] === "") throw new Error(`missing ${name} cookie`);
  return match[1];
}

async function signIn(email: string, password: string): Promise<string> {
  const anonymous = await getCsrf(request("/api/v1/auth/csrf"));
  const response = await login(
    request("/api/v1/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        cookie: `fa_presession=${cookieValue(anonymous, "fa_presession")}`,
        "x-csrf-token": (await anonymous.json()).csrfToken as string,
      },
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(response.status).toBe(200);
  return cookieValue(response, "fa_session");
}

function readJob(id: string): Promise<Response> {
  return jobRoute.GET(request(`/api/v1/ai/jobs/${id}`, { headers: { cookie: `fa_session=${adminSession}` } }), {
    params: Promise.resolve({ id }),
  });
}

async function insertJob(job: {
  readonly subjectId: string;
  readonly status: "running" | "succeeded" | "failed" | "stale";
  readonly errorCode?: string | null;
  readonly requesterId?: string | null;
}): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app.ai_job (type, trigger, requester_id, subject_id, input_revision, dedup_key, status, attempt_count,
                             lease_until, expires_at, model_id, prompt_version, policy_version, input_hash,
                             bounded_input_snapshot, error_code)
     VALUES ('review_moderation', 'review_write', $1, $2, 1, $3, $4, 1, now() + interval '60 seconds',
             now() + interval '7 days', $5, $6, $7, $8, $9::jsonb, $10)
     RETURNING id`,
    [
      job.requesterId ?? null,
      job.subjectId,
      `dedup-${randomUUID()}`,
      job.status,
      MODEL_CANARY,
      PROMPT_CANARY,
      POLICY_CANARY,
      HASH_CANARY,
      JSON.stringify({ note: SNAPSHOT_CANARY }),
      job.errorCode ?? null,
    ],
  );
  return rows[0]!.id;
}

async function tableCounts(): Promise<string> {
  const { rows } = await owner.query(
    `SELECT (SELECT count(*) FROM app.ai_job) AS jobs, (SELECT count(*) FROM app.moderation_work) AS work,
            (SELECT count(*) FROM app.review_moderation) AS results, (SELECT count(*) FROM app.audit_entry) AS audit,
            (SELECT count(*) FROM app.ai_budget_reservation) AS reservations,
            (SELECT max(updated_at) FROM app.ai_job) AS job_updated`,
  );
  return JSON.stringify(rows);
}

beforeAll(async () => {
  owner = await connectAsOwner();
  await composition.firstAdminBootstrapService!.bootstrap({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    requestId: randomUUID() as never,
  });
  adminSession = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  const { rows } = await owner.query<{ id: string }>("SELECT id FROM app.account WHERE normalized_email = $1", [
    ADMIN_EMAIL,
  ]);
  adminId = rows[0]!.id;
});

afterAll(async () => {
  await owner.end();
});

beforeEach(async () => {
  await owner.query("TRUNCATE app.review_moderation, app.ai_budget_reservation, app.ai_job CASCADE");
});

describe("GET /api/v1/ai/jobs/:id (D-102, D-103 I1)", () => {
  for (const [status, errorCode] of [
    ["running", null],
    ["succeeded", null],
    ["failed", "provider_misconfigured"],
    ["stale", "publish_stale"],
  ] as const) {
    it(`returns 200 with no-store for a ${status} job and only the D-102 fields`, async () => {
      const { reviewId, authorId } = await seedReview(owner);
      const id = await insertJob({ subjectId: reviewId, status, errorCode, requesterId: authorId });

      const response = await readJob(id);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual([
        "createdAt",
        "errorCode",
        "id",
        "result",
        "retryAfterSeconds",
        "reviewId",
        "state",
        "updatedAt",
      ]);
      expect(body).toMatchObject({ id, reviewId, state: status, errorCode, result: null });
      if (status === "running") {
        expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
        expect(body.retryAfterSeconds).toBeLessThanOrEqual(60);
      } else {
        expect(body.retryAfterSeconds).toBeNull();
      }
      const text = JSON.stringify(body);
      for (const hidden of [authorId, SNAPSHOT_CANARY, POLICY_CANARY, PROMPT_CANARY, MODEL_CANARY, HASH_CANARY, "dedup-"]) {
        expect(text).not.toContain(hidden);
      }
    });
  }

  it("does not expose the requesting Admin either", async () => {
    const { reviewId } = await seedReview(owner);
    const id = await insertJob({ subjectId: reviewId, status: "failed", errorCode: "invalid_output", requesterId: adminId });

    expect(JSON.stringify(await (await readJob(id)).json())).not.toContain(adminId);
  });

  it("gives no result for a succeeded job whose stored assessment is outside the AI-02 enum", async () => {
    const { reviewId } = await seedReview(owner);
    const id = await insertJob({ subjectId: reviewId, status: "succeeded" });
    await owner.query(
      `INSERT INTO app.review_moderation (job_id, review_id, content_revision, captured_review_version, model_id,
                                          prompt_version, policy_version, output_json, generated_at)
       VALUES ($1, $2, 1, 1, 'fake-model', 'p', 'q', '{"assessment": "<script>x</script>"}'::jsonb, now())`,
      [id, reviewId],
    );

    expect(await (await readJob(id)).json()).toMatchObject({ state: "succeeded", result: null });
  });

  it("never shows an assessment for a job that did not succeed, even when a result row exists", async () => {
    const { reviewId } = await seedReview(owner);
    const id = await insertJob({ subjectId: reviewId, status: "stale", errorCode: "lease_expired" });
    await owner.query(
      `INSERT INTO app.review_moderation (job_id, review_id, content_revision, captured_review_version, model_id,
                                          prompt_version, policy_version, output_json, generated_at)
       VALUES ($1, $2, 1, 1, 'fake-model', 'p', 'q', '{"assessment": "uncertain"}'::jsonb, now())`,
      [id, reviewId],
    );

    expect(await (await readJob(id)).json()).toMatchObject({ state: "stale", result: null });
  });

  it("reads a running job repeatedly without writing, dispatching or extending its lease", async () => {
    const { reviewId } = await seedReview(owner);
    const id = await insertJob({ subjectId: reviewId, status: "running" });
    const { rows: before } = await owner.query("SELECT lease_until, status FROM app.ai_job WHERE id = $1", [id]);
    const counts = await tableCounts();

    for (let read = 0; read < 3; read += 1) {
      expect((await readJob(id)).status).toBe(200);
    }

    expect(await tableCounts()).toBe(counts);
    const { rows: after } = await owner.query("SELECT lease_until, status FROM app.ai_job WHERE id = $1", [id]);
    expect(after).toEqual(before);
  });

  it("returns 404 for IDs with SQL or path content", async () => {
    for (const id of ["' OR '1'='1", "../summary", `${randomUUID()}x`, "%00"]) {
      const response = await readJob(id);
      expect(response.status).toBe(404);
    }
  });
});
