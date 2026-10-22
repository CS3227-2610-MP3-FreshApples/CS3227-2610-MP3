import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { testDatabaseUrl } from "../../database/test-database";
import { connectAsOwner, insertAccount } from "../../database/schema-fixtures";
import { hashSessionToken } from "../../../../src/server/services/identity";

process.env.APP_ENV = "test";
process.env.PUBLIC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = "synthetic-session-secret-012345678901234567890123456789";
process.env.RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-012345678901234567890123456789";
process.env.AI_ENABLED = "false";
delete process.env.DATABASE_CA_CERT;

const reportsRoute = await import("../../../../src/app/api/v1/admin/reports/route");
const reportRoute = await import("../../../../src/app/api/v1/admin/reports/[id]/route");
const decisionRoute = await import("../../../../src/app/api/v1/admin/reports/[id]/decision/route");
const { GET: csrf } = await import("../../../../src/app/api/v1/auth/csrf/route");

const ORIGIN = "http://localhost:3000";
let owner: Client;
let admin: { token: string; csrf: string };

beforeAll(async () => { owner = await connectAsOwner(); });
afterAll(async () => { await owner.end(); });

beforeEach(async () => {
  await owner.query("TRUNCATE app.account, app.movie CASCADE");
  const accountId = await insertAccount(owner, "ADMIN");
  const token = randomBytes(32).toString("base64url");
  await owner.query("INSERT INTO app.session (account_id, hashed_token, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [accountId, hashSessionToken(token)]);
  const response = await csrf(new Request(`${ORIGIN}/api/v1/auth/csrf`, { headers: { cookie: `fa_session=${token}` } }));
  admin = { token, csrf: (await response.json()).csrfToken as string };
});

async function seedReport(status: "open" | "accepted" | "dismissed" = "open"): Promise<string> {
  const reporterId = await insertAccount(owner, "USER");
  const targetId = await insertAccount(owner, "USER");
  const movie = await owner.query<{ id: string }>(
    `INSERT INTO app.movie (title, synopsis, director) VALUES ('A-05 Movie', 'A-05 synopsis.', '') RETURNING id`,
  );
  const review = await owner.query<{ id: string; version: number }>(
    `INSERT INTO app.review (movie_id, author_id, rating, body, moderation_state)
     VALUES ($1, $2, 8, 'A review body long enough for evidence.', 'cleared') RETURNING id, version`,
    [movie.rows[0]!.id, targetId],
  );
  const report = await owner.query<{ id: string }>(
    `INSERT INTO app.report (reporter_id, target_user_id, review_id, category, explanation, evidence_snapshot, status)
     VALUES ($1, $2, $3, 'harassment', 'A sufficiently detailed report explanation.', $4, $5) RETURNING id`,
    [reporterId, targetId, review.rows[0]!.id, JSON.stringify({ reviewId: review.rows[0]!.id, reviewVersion: review.rows[0]!.version, authorId: targetId, movieId: movie.rows[0]!.id, movieTitle: "A-05 Movie", body: "A review body long enough for evidence.", rating: 8 }), status],
  );
  return report.rows[0]!.id;
}

function request(path: string): Request {
  return new Request(`${ORIGIN}${path}`, { headers: { cookie: `fa_session=${admin.token}` } });
}

function decisionRequest(id: string, body: unknown, version = 1): Request {
  return new Request(`${ORIGIN}/api/v1/admin/reports/${id}/decision`, {
    method: "POST",
    headers: { cookie: `fa_session=${admin.token}`, origin: ORIGIN, "x-csrf-token": admin.csrf, "if-match": `"${version}"`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("A-05 Admin Report reads", () => {
  it("applies default-open, all/category filters, stable pagination and the detail projection", async () => {
    const openId = await seedReport("open");
    await seedReport("dismissed");
    const list = await reportsRoute.GET(request("/api/v1/admin/reports?page=1&pageSize=1"));
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toBe("no-store");
    expect(await list.json()).toMatchObject({ total: 1, page: 1, pageSize: 1, items: [{ id: openId, status: "open", category: "harassment" }] });

    const all = await reportsRoute.GET(request("/api/v1/admin/reports?status=all&category=harassment"));
    expect(await all.json()).toMatchObject({ total: 2 });

    const detail = await reportRoute.GET(request(`/api/v1/admin/reports/${openId}`), { params: Promise.resolve({ id: openId }) });
    expect(detail.status).toBe(200);
    expect(detail.headers.get("etag")).toBe('"1"');
    expect(await detail.json()).toMatchObject({
      id: openId,
      explanation: "A sufficiently detailed report explanation.",
      evidence: { movieTitle: "A-05 Movie", rating: 8 },
      liveReview: { moderationState: "cleared", hidden: false, deleted: false },
      target: { strikeCount: 0, strikeThreshold: 3 },
      projectedEffect: { strikeAdded: true, strikeCountAfter: 1, wouldSuspend: false, accountStatusAfter: "active" },
      decision: null,
    });
  });

  it("does not expose Admin report data to an unauthenticated caller", async () => {
    const id = await seedReport();
    const response = await reportsRoute.GET(new Request(`${ORIGIN}/api/v1/admin/reports`));
    expect(response.status).toBe(401);
    expect((await reportRoute.GET(new Request(`${ORIGIN}/api/v1/admin/reports/${id}`), { params: Promise.resolve({ id }) })).status).toBe(401);
  });

  it("accepts a report atomically, records one strike, hides the Review through K8, and writes the audit entry", async () => {
    const id = await seedReport();
    const response = await decisionRoute.POST(decisionRequest(id, { disposition: "accepted", actions: ["hide_review"], reason: "A valid acceptance reason." }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"2"');
    expect(await response.json()).toMatchObject({ report: { id, status: "accepted" }, decision: { disposition: "accepted", actions: ["hide_review"] }, strikeAdded: true, accountStatus: "active" });
    const report = await owner.query<{ status: string; version: number }>("SELECT status, version FROM app.report WHERE id = $1", [id]);
    const strike = await owner.query<{ total: number }>("SELECT count(*)::integer AS total FROM app.moderation_strike WHERE accepted_report_id = $1", [id]);
    const review = await owner.query<{ hidden: boolean }>("SELECT hidden_at IS NOT NULL AS hidden FROM app.review r JOIN app.report p ON p.review_id = r.id WHERE p.id = $1", [id]);
    const audit = await owner.query<{ action: string }>("SELECT action FROM app.audit_entry WHERE target_type = 'report' AND target_id = $1", [id]);
    expect(report.rows[0]).toEqual({ status: "accepted", version: 2 });
    expect(strike.rows[0]?.total).toBe(1);
    expect(review.rows[0]?.hidden).toBe(true);
    expect(audit.rows[0]?.action).toBe("report.accept");
  });
});
