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

const userStatusRoute = await import("../../../../src/app/api/v1/admin/users/[id]/status/route");
const decisionRoute = await import("../../../../src/app/api/v1/admin/reports/[id]/decision/route");
const { GET: csrf } = await import("../../../../src/app/api/v1/auth/csrf/route");

const ORIGIN = "http://localhost:3000";
let owner: Client;
let admin: { token: string; csrf: string };
let adminId: string;

beforeAll(async () => { owner = await connectAsOwner(); });
afterAll(async () => { await owner.end(); });

beforeEach(async () => {
  await owner.query("TRUNCATE app.account, app.movie CASCADE");
  adminId = await insertAccount(owner, "ADMIN");
  const token = randomBytes(32).toString("base64url");
  await owner.query("INSERT INTO app.session (account_id, hashed_token, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [adminId, hashSessionToken(token)]);
  const response = await csrf(new Request(`${ORIGIN}/api/v1/auth/csrf`, { headers: { cookie: `fa_session=${token}` } }));
  admin = { token, csrf: (await response.json()).csrfToken as string };
});

function headers(extra: Record<string, string> = {}): HeadersInit {
  return { cookie: `fa_session=${admin.token}`, origin: ORIGIN, "x-csrf-token": admin.csrf, ...extra };
}

describe("AT-25 Admin user status/report serialization", () => {
  it("serializes manual suspension with concurrent report acceptance", async () => {
    const reporterId = await insertAccount(owner, "USER");
    const targetId = await insertAccount(owner, "USER");
    const targetSession = randomBytes(32).toString("base64url");
    await owner.query("INSERT INTO app.session (account_id, hashed_token, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [targetId, hashSessionToken(targetSession)]);
    const movie = await owner.query<{ id: string }>("INSERT INTO app.movie (title, synopsis, director) VALUES ('AT-25 Movie', 'AT-25 synopsis.', '') RETURNING id");
    const review = await owner.query<{ id: string; version: number }>(
      "INSERT INTO app.review (movie_id, author_id, rating, body, moderation_state) VALUES ($1, $2, 8, 'AT-25 review body.', 'cleared') RETURNING id, version",
      [movie.rows[0]!.id, targetId],
    );
    const report = await owner.query<{ id: string }>(
      "INSERT INTO app.report (reporter_id, target_user_id, review_id, category, explanation, evidence_snapshot, status) VALUES ($1, $2, $3, 'harassment', 'AT-25 explanation.', $4, 'open') RETURNING id",
      [reporterId, targetId, review.rows[0]!.id, JSON.stringify({ reviewId: review.rows[0]!.id, reviewVersion: review.rows[0]!.version, authorId: targetId, movieId: movie.rows[0]!.id, movieTitle: "AT-25 Movie", body: "AT-25 review body.", rating: 8 })],
    );

    const statusRequest = new Request(`${ORIGIN}/api/v1/admin/users/${targetId}/status`, {
      method: "PATCH",
      headers: headers({ "content-type": "application/json", "if-match": '"1"' }),
      body: JSON.stringify({ status: "suspended", reason: "AT-25 concurrent status test." }),
    });
    const reportRequest = new Request(`${ORIGIN}/api/v1/admin/reports/${report.rows[0]!.id}/decision`, {
      method: "POST",
      headers: headers({ "content-type": "application/json", "if-match": '"1"' }),
      body: JSON.stringify({ disposition: "accepted", actions: ["hide_review"], reason: "AT-25 concurrent report test." }),
    });

    const [statusResponse, reportResponse] = await Promise.all([
      userStatusRoute.PATCH(statusRequest, { params: Promise.resolve({ id: targetId }) }),
      decisionRoute.POST(reportRequest, { params: Promise.resolve({ id: report.rows[0]!.id }) }),
    ]);

    expect(statusResponse.status).toBe(200);
    expect(reportResponse.status).toBe(200);
    const account = await owner.query<{ status: string; version: number; strike_cycle: number }>("SELECT status, version, strike_cycle FROM app.account WHERE id = $1", [targetId]);
    const sessions = await owner.query<{ count: number }>("SELECT count(*)::int AS count FROM app.session WHERE account_id = $1", [targetId]);
    const accepted = await owner.query<{ status: string }>("SELECT status FROM app.report WHERE id = $1", [report.rows[0]!.id]);
    const strikes = await owner.query<{ count: number }>("SELECT count(*)::int AS count FROM app.moderation_strike WHERE target_user_id = $1", [targetId]);
    const audits = await owner.query<{ action: string }>("SELECT action FROM app.audit_entry WHERE target_id = $1 ORDER BY created_at, id", [targetId]);

    expect(account.rows[0]).toEqual({ status: "suspended", version: 2, strike_cycle: 0 });
    expect(sessions.rows[0]?.count).toBe(0);
    expect(accepted.rows[0]?.status).toBe("accepted");
    expect(strikes.rows[0]?.count).toBe(1);
    expect(audits.rows.map((row) => row.action)).toEqual(["account.suspend"]);
  });

  it("covers no-op, reinstatement, stale versions, and session-cycle effects through the status endpoint", async () => {
    const targetId = await insertAccount(owner, "USER");
    const suspend = await userStatusRoute.PATCH(new Request(`${ORIGIN}/api/v1/admin/users/${targetId}/status`, {
      method: "PATCH", headers: headers({ "content-type": "application/json", "if-match": '"1"' }),
      body: JSON.stringify({ status: "suspended", reason: "AT-25 endpoint suspension." }),
    }), { params: Promise.resolve({ id: targetId }) });
    expect(suspend.status).toBe(200);

    const noOp = await userStatusRoute.PATCH(new Request(`${ORIGIN}/api/v1/admin/users/${targetId}/status`, {
      method: "PATCH", headers: headers({ "content-type": "application/json", "if-match": '"2"' }),
      body: JSON.stringify({ status: "suspended", reason: "AT-25 endpoint no-op." }),
    }), { params: Promise.resolve({ id: targetId }) });
    expect(noOp.status).toBe(200);
    expect(noOp.headers.get("etag")).toBe('"2"');

    const stale = await userStatusRoute.PATCH(new Request(`${ORIGIN}/api/v1/admin/users/${targetId}/status`, {
      method: "PATCH", headers: headers({ "content-type": "application/json", "if-match": '"3"' }),
      body: JSON.stringify({ status: "active", reason: "AT-25 stale version." }),
    }), { params: Promise.resolve({ id: targetId }) });
    expect(stale.status).toBe(409);

    const reinstate = await userStatusRoute.PATCH(new Request(`${ORIGIN}/api/v1/admin/users/${targetId}/status`, {
      method: "PATCH", headers: headers({ "content-type": "application/json", "if-match": '"2"' }),
      body: JSON.stringify({ status: "active", reason: "AT-25 endpoint reinstatement." }),
    }), { params: Promise.resolve({ id: targetId }) });
    expect(reinstate.status).toBe(200);

    const account = await owner.query<{ status: string; version: number; strike_cycle: number }>("SELECT status, version, strike_cycle FROM app.account WHERE id = $1", [targetId]);
    const sessions = await owner.query<{ count: number }>("SELECT count(*)::int AS count FROM app.session WHERE account_id = $1", [targetId]);
    const audits = await owner.query<{ action: string; result: string }>("SELECT action, result FROM app.audit_entry WHERE target_id = $1 ORDER BY created_at, id", [targetId]);
    expect(account.rows[0]).toEqual({ status: "active", version: 3, strike_cycle: 1 });
    expect(sessions.rows[0]?.count).toBe(0);
    expect(audits.rows.map((row) => [row.action, row.result])).toEqual([
      ["account.suspend", "applied"],
      ["account.suspend", "no_op"],
      ["account.reinstate", "applied"],
    ]);
  });

  it("rejects anonymous, CSRF-less, suspended-Admin, and Admin-target mutations", async () => {
    const targetId = await insertAccount(owner, "USER");
    const anonymous = await userStatusRoute.PATCH(new Request(`${ORIGIN}/api/v1/admin/users/${targetId}/status`, {
      method: "PATCH", headers: { origin: ORIGIN, "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify({ status: "suspended", reason: "AT-25 anonymous." }),
    }), { params: Promise.resolve({ id: targetId }) });
    expect(anonymous.status).toBe(401);

    const csrfless = await userStatusRoute.PATCH(new Request(`${ORIGIN}/api/v1/admin/users/${targetId}/status`, {
      method: "PATCH", headers: { cookie: `fa_session=${admin.token}`, origin: ORIGIN, "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify({ status: "suspended", reason: "AT-25 CSRF-less." }),
    }), { params: Promise.resolve({ id: targetId }) });
    expect(csrfless.status).toBe(403);

    await owner.query("UPDATE app.account SET status = 'suspended', version = version + 1 WHERE id = $1", [adminId]);
    const suspendedAdmin = await userStatusRoute.PATCH(new Request(`${ORIGIN}/api/v1/admin/users/${targetId}/status`, {
      method: "PATCH", headers: headers({ "content-type": "application/json", "if-match": '"1"' }),
      body: JSON.stringify({ status: "suspended", reason: "AT-25 suspended Admin." }),
    }), { params: Promise.resolve({ id: targetId }) });
    expect(suspendedAdmin.status).toBe(403);

    await owner.query("UPDATE app.account SET status = 'active', version = version + 1 WHERE id = $1", [adminId]);
    const adminTarget = await userStatusRoute.PATCH(new Request(`${ORIGIN}/api/v1/admin/users/${adminId}/status`, {
      method: "PATCH", headers: headers({ "content-type": "application/json", "if-match": '"3"' }),
      body: JSON.stringify({ status: "suspended", reason: "AT-25 Admin target." }),
    }), { params: Promise.resolve({ id: adminId }) });
    expect(adminTarget.status).toBe(403);
  });
});
