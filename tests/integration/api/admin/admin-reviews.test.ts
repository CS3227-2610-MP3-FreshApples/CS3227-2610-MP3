import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabaseUrl } from "../../database/test-database";
import { connectAsOwner, insertAccount, insertAiJob } from "../../database/schema-fixtures";
import { seedReview, seedWork, workRows } from "../../ai/moderation/fixtures";
import { hashSessionToken } from "../../../../src/server/services/identity";

process.env.APP_ENV = "test";
process.env.PUBLIC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = "synthetic-session-secret-012345678901234567890123456789";
process.env.RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-012345678901234567890123456789";
process.env.AI_ENABLED = "false";
delete process.env.DATABASE_CA_CERT;
const listRoute = await import("../../../../src/app/api/v1/admin/reviews/route");
const detailRoute = await import("../../../../src/app/api/v1/admin/reviews/[id]/route");
const approveRoute = await import("../../../../src/app/api/v1/admin/reviews/[id]/approve/route");
const hideRoute = await import("../../../../src/app/api/v1/admin/reviews/[id]/hide/route");
const restoreRoute = await import("../../../../src/app/api/v1/admin/reviews/[id]/restore/route");
const { GET: csrf } = await import("../../../../src/app/api/v1/auth/csrf/route");
const composition = await import("../../../../src/server/composition");
const ORIGIN = "http://localhost:3000";
const REASON = "Human reviewed this text.";
let owner: Client;
let admin: { token: string; csrf: string };
let user: typeof admin;
const context = (id: string) => ({ params: Promise.resolve({ id }) });
beforeAll(async () => { owner = await connectAsOwner(); });
afterAll(async () => { await owner.end(); });
beforeEach(async () => {
  await owner.query("TRUNCATE app.account, app.movie CASCADE");
  async function credentials(role: "ADMIN" | "USER") {
    const id = await insertAccount(owner, role);
    const token = randomBytes(32).toString("base64url");
    await owner.query("INSERT INTO app.session (account_id, hashed_token, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [id, hashSessionToken(token)]);
    const response = await csrf(new Request(`${ORIGIN}/api/v1/auth/csrf`, { headers: { cookie: `fa_session=${token}` } }));
    return { token, csrf: (await response.json()).csrfToken as string };
  }
  admin = await credentials("ADMIN");
  user = await credentials("USER");
});
const routes = { approve: approveRoute, hide: hideRoute, restore: restoreRoute };
function mutate(action: keyof typeof routes, id: string, options: { who?: typeof admin; version?: string | null; body?: unknown; origin?: string } = {}) {
  const who = options.who ?? admin;
  return routes[action].POST(new Request(`${ORIGIN}/api/v1/admin/reviews/${id}/${action}`, {
    method: "POST", headers: { cookie: `fa_session=${who.token}`, origin: options.origin ?? ORIGIN, "x-csrf-token": who.csrf,
      "content-type": "application/json", ...(options.version === null ? {} : { "if-match": options.version ?? '"1"' }) },
    body: JSON.stringify(options.body ?? { reason: REASON }),
  }), context(id));
}
function list(query = "", who = admin) {
  return listRoute.GET(new Request(`${ORIGIN}/api/v1/admin/reviews${query}`, { headers: { cookie: `fa_session=${who.token}` } }));
}
function detail(id: string, who = admin) {
  return detailRoute.GET(new Request(`${ORIGIN}/api/v1/admin/reviews/${id}`, { headers: { cookie: `fa_session=${who.token}` } }), context(id));
}
async function state(id: string) { return (await owner.query("SELECT * FROM app.review WHERE id = $1", [id])).rows[0]; }
async function audit(id: string) { return (await owner.query("SELECT * FROM app.audit_entry WHERE target_id = $1 ORDER BY created_at, id", [id])).rows; }

describe("A-04 transitions", () => {
  it.each(["pending", "running", "needs_manual_review"])("hide cancels %s work without consuming attempts", async (status) => {
    const { reviewId } = await seedReview(owner);
    await seedWork(owner, reviewId, { status, executionCount: 2 });
    expect((await mutate("hide", reviewId)).status).toBe(200);
    expect(await workRows(owner, reviewId)).toEqual([expect.objectContaining({ status: "cancelled", execution_count: 2 })]);
  });
  it("restore leaves pending text unpublished and reactivates the same row with its attempt history", async () => {
    const { reviewId } = await seedReview(owner, { hidden: true });
    const workId = await seedWork(owner, reviewId, { status: "cancelled", executionCount: 3, lastAttemptInSeconds: -600, nextAttemptInSeconds: 500 });
    await owner.query("UPDATE app.moderation_work SET model_id = 'original-model' WHERE id = $1", [workId]);
    const before = (await workRows(owner, reviewId))[0]!;
    const dispatch = vi.spyOn(composition.moderationDispatcher!, "attemptAfterCommit");
    const response = await mutate("restore", reviewId);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"2"');
    expect(await response.json()).toMatchObject({ hidden: false, moderationState: "pending", eligibilityChanged: false });
    const rows = await workRows(owner, reviewId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: workId, status: "pending", execution_count: 3, model_id: "original-model", last_attempt_at: before.last_attempt_at });
    expect(rows[0]!.next_in_seconds).toBeLessThanOrEqual(0);
    expect(dispatch).not.toHaveBeenCalled();
    dispatch.mockRestore();
    expect((await owner.query("SELECT * FROM app.ai_job")).rows).toHaveLength(0);
    expect((await owner.query("SELECT reviews_revision FROM app.movie")).rows[0].reviews_revision).toBe(0);
  });
  it.each([{ policyVersion: "old-policy" }, { promptVersion: "old-prompt" }, { contentRevision: 1 }])("restore inserts current work when versions changed: %j", async (old) => {
    const { reviewId } = await seedReview(owner, { hidden: true, contentRevision: 2 });
    const oldId = await seedWork(owner, reviewId, { contentRevision: 2, ...old, status: "cancelled", executionCount: 2 });
    expect((await mutate("restore", reviewId)).status).toBe(200);
    const rows = await workRows(owner, reviewId);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === oldId)).toMatchObject({ status: "cancelled", execution_count: 2 });
    expect(rows.find((row) => row.id !== oldId)).toMatchObject({ content_revision: 2, status: "pending", execution_count: 0, model_id: null, last_attempt_at: null });
  });
  it.each(["pending", "running", "completed", "needs_manual_review", "superseded"])("restore leaves an existing %s work row unchanged", async (status) => {
    const { reviewId } = await seedReview(owner, { hidden: true });
    await seedWork(owner, reviewId, { status, executionCount: 2 });
    const before = (await workRows(owner, reviewId))[0]!;
    expect((await mutate("restore", reviewId)).status).toBe(200);
    expect((await workRows(owner, reviewId))[0]).toMatchObject({ id: before.id, status, execution_count: 2, next_attempt_at: before.next_attempt_at });
  });
  it.each([{ state: "flagged" as const }, { state: "cleared" as const }, { deleted: true }])("restore does not reactivate or create work for %j", async (seed) => {
    for (const existing of [true, false]) {
      const { reviewId } = await seedReview(owner, { hidden: true, ...seed });
      if (existing) await seedWork(owner, reviewId, { status: "cancelled" });
      expect((await mutate("restore", reviewId)).status).toBe(200);
      expect((await state(reviewId)).moderation_state).toBe(seed.state ?? "pending");
      expect(await workRows(owner, reviewId)).toEqual(existing ? [expect.objectContaining({ status: "cancelled" })] : []);
    }
  });
  it("approve preserves deletion and hidden_at, supersedes outstanding work and adds no strike", async () => {
    const { reviewId } = await seedReview(owner, { deleted: true, hidden: true });
    for (const [index, status] of ["pending", "running", "needs_manual_review", "completed", "cancelled"].entries()) {
      await seedWork(owner, reviewId, { status, promptVersion: `test-${index}` });
    }
    expect((await mutate("approve", reviewId)).status).toBe(200);
    expect(await state(reviewId)).toMatchObject({ moderation_state: "cleared", clearance_source: "admin", version: 2, deleted_at: expect.any(Date), hidden_at: expect.any(Date) });
    expect((await workRows(owner, reviewId)).map((row) => row.status)).toEqual(["superseded", "superseded", "superseded", "completed", "cancelled"]);
    expect((await owner.query("SELECT * FROM app.moderation_strike")).rows).toEqual([]);
  });
  it.each(["approve", "hide", "restore"] as const)("%s no-op preserves version, timestamps and work and audits no_op", async (action) => {
    const { reviewId } = await seedReview(owner, { state: action === "approve" ? "cleared" : "pending", hidden: action === "hide" });
    await seedWork(owner, reviewId, { status: "cancelled" });
    const before = await state(reviewId);
    const response = await mutate(action, reviewId);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(await state(reviewId)).toEqual(before);
    expect((await workRows(owner, reviewId))[0]!.status).toBe("cancelled");
    expect(await audit(reviewId)).toEqual([expect.objectContaining({ result: "no_op", action: `review.${action}`, before_after_metadata: expect.objectContaining({ reason: REASON }) })]);
    expect((await mutate(action, reviewId, { version: '"0"' })).status).toBe(409);
    expect(await audit(reviewId)).toHaveLength(1);
  });
  it("permits all transitions on archived Movies without public eligibility", async () => {
    const { reviewId } = await seedReview(owner, { archivedMovie: true });
    for (const [i, action] of (["approve", "hide", "restore"] as const).entries()) {
      const response = await mutate(action, reviewId, { version: `"${i + 1}"` });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ eligibilityChanged: false });
    }
    expect((await owner.query("SELECT reviews_revision FROM app.movie")).rows[0].reviews_revision).toBe(0);
  });
  it("rolls back Review, queue and Movie revision if audit fails", async () => {
    const { reviewId } = await seedReview(owner);
    await seedWork(owner, reviewId);
    const log = vi.spyOn(composition.auditLog!, "record").mockRejectedValueOnce(new Error("synthetic audit failure"));
    expect((await mutate("approve", reviewId)).status).toBe(500);
    log.mockRestore();
    expect(await state(reviewId)).toMatchObject({ version: 1, moderation_state: "pending" });
    expect((await workRows(owner, reviewId))[0]!.status).toBe("pending");
    expect((await owner.query("SELECT reviews_revision FROM app.movie")).rows[0].reviews_revision).toBe(0);
  });
  it("advances public eligibility revisions once per real change and rejects competing stale writes", async () => {
    const { reviewId } = await seedReview(owner);
    await seedWork(owner, reviewId);
    const responses = await Promise.all([mutate("approve", reviewId), mutate("approve", reviewId)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await owner.query("SELECT reviews_revision FROM app.movie")).rows[0].reviews_revision).toBe(1);
    expect((await mutate("hide", reviewId, { version: '"2"' })).status).toBe(200);
    expect((await mutate("restore", reviewId, { version: '"3"' })).status).toBe(200);
    expect((await owner.query("SELECT reviews_revision FROM app.movie")).rows[0].reviews_revision).toBe(3);
    expect(await audit(reviewId)).toHaveLength(3);
  });
});

describe("A-04 reads and security", () => {
  it("returns the latest labelled assessment, uses its ID tie-break, and excludes old revisions from assessment filters", async () => {
    const { reviewId } = await seedReview(owner, { state: "flagged" });
    const ids = ["10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001"];
    for (const [index, id] of ids.entries()) {
      const jobId = await insertAiJob(owner, { dedupKey: `assessment-${index}`, status: "succeeded" });
      const output = { assessment: index === 0 ? "uncertain" : "no_profanity_detected", explanation: "Synthetic assessment.", matches: [], limitations: [] };
      await owner.query(`INSERT INTO app.review_moderation
        (id, job_id, review_id, content_revision, captured_review_version, model_id, prompt_version, policy_version, output_json, generated_at)
        VALUES ($1, $2, $3, 1, 1, 'synthetic-model', 'synthetic-prompt', 'synthetic-policy', $4, '2026-01-01T00:00:00Z')`,
      [id, jobId, reviewId, JSON.stringify(output)]);
    }
    const response = await detail(reviewId);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(await response.json()).toMatchObject({ body: expect.any(String), latestAssessment: {
      contentRevision: 1, capturedReviewVersion: 1, generatedAt: "2026-01-01T00:00:00.000Z",
      result: { assessment: "uncertain", explanation: "Synthetic assessment.", matches: [], limitations: [] },
    } });
    expect((await (await list("?assessment=uncertain")).json()).total).toBe(1);
    expect((await (await list("?assessment=no_profanity_detected")).json()).total).toBe(0);
    await owner.query("UPDATE app.review SET content_revision = 2, version = 2, moderation_state = 'pending' WHERE id = $1", [reviewId]);
    expect((await (await list("?assessment=uncertain")).json()).total).toBe(0);
    expect(await (await detail(reviewId)).json()).toMatchObject({ contentRevision: 2, latestAssessment: { contentRevision: 1 } });
  });
  it("lists all states by updated_at descending with an ascending ID tie-break, paginates and filters", async () => {
    const seeds = [{}, { state: "flagged" as const }, { hidden: true }, { deleted: true }, { state: "cleared" as const }];
    const reviews = [];
    for (const seed of seeds) reviews.push(await seedReview(owner, seed));
    await seedWork(owner, reviews[0]!.reviewId, { status: "needs_manual_review", executionCount: 3 });
    await owner.query("UPDATE app.review SET updated_at = '2026-01-01T00:00:00Z'");
    const response = await list();
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.total).toBe(5);
    expect(body.items.map((row: { id: string }) => row.id)).toEqual(reviews.map((row) => row.reviewId).sort());
    for (const [filter, index] of [["flagged", 1], ["hidden", 2], ["deleted", 3], ["cleared", 4], ["needs_manual_review", 0], ["failed", 0]] as const) {
      expect((await (await list(`?assessment=${filter}`)).json()).items.map((row: { id: string }) => row.id)).toEqual([reviews[index]!.reviewId]);
    }
    expect((await (await list(`?movieId=${reviews[2]!.movieId}`)).json()).total).toBe(1);
    expect((await (await list(`?movieId=${reviews[2]!.movieId}&assessment=flagged`)).json()).total).toBe(0);
    expect(await (await list("?page=100&pageSize=2")).json()).toMatchObject({ items: [], total: 5 });
    const item = await (await detail(reviews[0]!.reviewId)).json();
    expect(item).toMatchObject({ version: 1, moderationState: "pending", latestAssessment: null,
      authorDisplayName: "Synthetic", movieTitle: "Synthetic Movie" });
    expect(item).not.toHaveProperty("password_hash");
  });
  it("rejects USER and anonymous access on every route, and enforces CSRF, reasons and If-Match", async () => {
    const { reviewId } = await seedReview(owner);
    expect((await list("", user)).status).toBe(403);
    expect((await detail(reviewId, user)).status).toBe(403);
    expect((await listRoute.GET(new Request(`${ORIGIN}/api/v1/admin/reviews`))).status).toBe(401);
    for (const action of ["approve", "hide", "restore"] as const) {
      expect((await mutate(action, reviewId, { who: user })).status).toBe(403);
      expect((await mutate(action, reviewId, { origin: "https://wrong.example" })).status).toBe(403);
      expect((await mutate(action, reviewId, { version: null })).status).toBe(428);
      expect((await mutate(action, reviewId, { version: "*" })).status).toBe(400);
      expect((await mutate(action, reviewId, { version: '"0"' })).status).toBe(409);
      for (const body of [{ reason: "short" }, { reason: "x".repeat(1001) }, { reason: REASON, version: 1 }]) {
        expect((await mutate(action, reviewId, { body })).status).toBe(422);
      }
      expect((await mutate(action, "malformed")).status).toBe(404);
    }
    expect((await detail("malformed")).status).toBe(404);
    expect((await list("?assessment=wrong")).status).toBe(422);
    expect((await list("?movieId=wrong")).status).toBe(422);
    expect(await audit(reviewId)).toEqual([]);
  });
  it("rejects a suspended Admin session", async () => {
    const { reviewId } = await seedReview(owner);
    await owner.query("UPDATE app.account SET status = 'suspended' WHERE role = 'ADMIN'");
    expect((await list()).status).toBe(403);
    expect((await detail(reviewId)).status).toBe(403);
    expect((await mutate("approve", reviewId)).status).toBe(403);
  });
});
