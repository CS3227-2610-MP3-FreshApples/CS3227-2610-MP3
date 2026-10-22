import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { testDatabaseUrl } from "../../database/test-database";

process.env.APP_ENV = "test";
process.env.PUBLIC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = "synthetic-session-secret-012345678901234567890123456789";
process.env.RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-012345678901234567890123456789";
delete process.env.DATABASE_CA_CERT;

const { GET: getCsrf } = await import("../../../../src/app/api/v1/auth/csrf/route");
const { POST: register } = await import("../../../../src/app/api/v1/auth/register/route");
const { POST: login } = await import("../../../../src/app/api/v1/auth/login/route");
const { POST: submitReport } = await import("../../../../src/app/api/v1/reports/route");
const { GET: listReports } = await import("../../../../src/app/api/v1/me/reports/route");
const { GET: getReport } = await import("../../../../src/app/api/v1/me/reports/[id]/route");
const { connectAsOwner, insertAccount, insertMovie, insertReview } = await import("../../database/schema-fixtures");
import { MALICIOUS_REPORT_EXPLANATION } from "../../../ai-evaluation/containment-v1";

const ORIGIN = "http://localhost:3000";

function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function cookieValue(response: Response, name: string): string {
  const match = (response.headers.get("set-cookie") ?? "").match(new RegExp(`${name}=([^;]*)`));
  if (match?.[1] === undefined || match[1] === "") throw new Error(`missing ${name} cookie`);
  return match[1];
}

interface Credentials {
  readonly session: string;
  readonly csrfToken: string;
}

async function registerAndSignIn(email: string): Promise<Credentials> {
  const anonymous = await getCsrf(request("/api/v1/auth/csrf"));
  const preSession = cookieValue(anonymous, "fa_presession");
  const registerResponse = await register(request("/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: `fa_presession=${preSession}`, "x-csrf-token": (await anonymous.json()).csrfToken as string },
    body: JSON.stringify({ email, password: "Report-password1!", displayName: "Report Reporter" }),
  }));
  expect(registerResponse.status).toBe(201);

  const loginCsrf = await getCsrf(request("/api/v1/auth/csrf"));
  const loginResponse = await login(request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: `fa_presession=${cookieValue(loginCsrf, "fa_presession")}`, "x-csrf-token": (await loginCsrf.json()).csrfToken as string },
    body: JSON.stringify({ email, password: "Report-password1!" }),
  }));
  expect(loginResponse.status).toBe(200);
  const session = cookieValue(loginResponse, "fa_session");
  const boundCsrf = await getCsrf(request("/api/v1/auth/csrf", { headers: { cookie: `fa_session=${session}` } }));
  return { session, csrfToken: (await boundCsrf.json()).csrfToken as string };
}

function reportRequest(credentials: Credentials, reviewId: string, explanation = "A valid report explanation."): Request {
  return request("/api/v1/reports", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: `fa_session=${credentials.session}`, "x-csrf-token": credentials.csrfToken },
    body: JSON.stringify({ reviewId, category: "spam", explanation }),
  });
}

describe("U-03 report API — PostgreSQL journey", () => {
  let owner: Client;

  beforeAll(async () => {
    owner = await connectAsOwner();
  });

  it("submits a report and reads only the reporter's receipt and history", async () => {
    const reporterEmail = `${randomUUID()}@example.test`;
    const credentials = await registerAndSignIn(reporterEmail);
    const reporter = await owner.query<{ id: string }>("SELECT id FROM app.account WHERE normalized_email = lower($1)", [reporterEmail]);
    const reporterId = reporter.rows[0]?.id;
    if (reporterId === undefined) throw new Error("missing reporter account");
    const authorId = await insertAccount(owner);
    const movieId = await insertMovie(owner);
    const reviewId = await insertReview(owner, movieId, authorId);
    await owner.query("UPDATE app.review SET moderation_state = 'cleared' WHERE id = $1", [reviewId]);

    const submitted = await submitReport(reportRequest(credentials, reviewId, MALICIOUS_REPORT_EXPLANATION));
    expect(submitted.status).toBe(201);
    expect(submitted.headers.get("cache-control")).toBe("no-store");
    const receipt = await submitted.json();
    expect(receipt).toMatchObject({ reviewId, category: "spam", status: "open" });
    expect(receipt).not.toHaveProperty("evidenceSnapshot");

    const csrfRejected = await submitReport(request("/api/v1/reports", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie: `fa_session=${credentials.session}` },
      body: JSON.stringify({ reviewId, category: "spam", explanation: "A valid report explanation." }),
    }));
    expect(csrfRejected.status).toBe(403);
    expect((await csrfRejected.json()).error.code).toBe("csrf_failed");

    const history = await listReports(request("/api/v1/me/reports", { headers: { cookie: `fa_session=${credentials.session}` } }));
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({ total: 1, items: [expect.objectContaining({ id: receipt.id, reviewId })] });

    const detail = await getReport(request(`/api/v1/me/reports/${receipt.id}`, { headers: { cookie: `fa_session=${credentials.session}` } }), { params: Promise.resolve({ id: receipt.id }) });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual(receipt);

    const stored = await owner.query<{ evidence_snapshot: unknown; reporter_id: string }>("SELECT evidence_snapshot, reporter_id FROM app.report WHERE id = $1", [receipt.id]);
    expect(stored.rows[0]?.reporter_id).toBe(reporterId);
    expect(stored.rows[0]?.evidence_snapshot).toBeTruthy();
    expect(JSON.stringify(receipt)).not.toContain(MALICIOUS_REPORT_EXPLANATION);

    const duplicate = await submitReport(reportRequest(credentials, reviewId));
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe("conflict");

    const concurrentAuthorId = await insertAccount(owner);
    const concurrentMovieId = await insertMovie(owner);
    const concurrentReviewId = await insertReview(owner, concurrentMovieId, concurrentAuthorId);
    await owner.query("UPDATE app.review SET moderation_state = 'cleared' WHERE id = $1", [concurrentReviewId]);
    const concurrent = await Promise.all([submitReport(reportRequest(credentials, concurrentReviewId)), submitReport(reportRequest(credentials, concurrentReviewId))]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);

    const otherCredentials = await registerAndSignIn(`${randomUUID()}@example.test`);
    const guessed = await getReport(request(`/api/v1/me/reports/${receipt.id}`, { headers: { cookie: `fa_session=${otherCredentials.session}` } }), { params: Promise.resolve({ id: receipt.id }) });
    expect(guessed.status).toBe(404);
    expect((await guessed.json()).error.code).toBe("not_found");
  });
});
