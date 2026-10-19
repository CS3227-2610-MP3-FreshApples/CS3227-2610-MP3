import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { testDatabaseUrl } from "../../database/test-database";

process.env.APP_ENV = "test";
process.env.PUBLIC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = "synthetic-session-secret-012345678901234567890123456789";
process.env.RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-012345678901234567890123456789";
delete process.env.DATABASE_CA_CERT;
delete process.env.ADMIN_BOOTSTRAP_SECRET;
delete process.env.ADMIN_BOOTSTRAP_EMAIL;
delete process.env.ADMIN_BOOTSTRAP_PASSWORD;

const { GET: getCsrf } = await import("../../../../src/app/api/v1/auth/csrf/route");
const { POST: register } = await import("../../../../src/app/api/v1/auth/register/route");
const { POST: login } = await import("../../../../src/app/api/v1/auth/login/route");
const { POST: logout } = await import("../../../../src/app/api/v1/auth/logout/route");
const { accountStatusService, csrfService, database } = await import("../../../../src/server/composition");
const { createSessionRepository } = await import("../../../../src/server/repositories/identity");
const { createSessionService } = await import("../../../../src/server/services/identity");
const { connectAsOwner } = await import("../../database/schema-fixtures");
import type { AccountId } from "../../../../src/server/shared";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "Correct-password1!";

function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function cookieValue(response: Response, name: string): string {
  const match = (response.headers.get("set-cookie") ?? "").match(new RegExp(`${name}=([^;]*)`));
  if (match?.[1] === undefined || match[1] === "") throw new Error(`missing ${name} cookie`);
  return match[1];
}

async function anonymousBinding(): Promise<{ readonly preSession: string; readonly csrfToken: string }> {
  const response = await getCsrf(request("/api/v1/auth/csrf"));
  expect(response.status).toBe(200);
  return {
    preSession: cookieValue(response, "fa_presession"),
    csrfToken: (await response.json()).csrfToken as string,
  };
}

async function registration(email: string): Promise<AccountId> {
  const binding = await anonymousBinding();
  const response = await register(request("/api/v1/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_presession=${binding.preSession}`,
      "x-csrf-token": binding.csrfToken,
    },
    body: JSON.stringify({ email, password: PASSWORD, displayName: "CSRF User" }),
  }));
  expect(response.status).toBe(201);
  return (await response.json()).id as AccountId;
}

async function loginSession(email: string): Promise<string> {
  const binding = await anonymousBinding();
  const response = await login(request("/api/v1/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_presession=${binding.preSession}`,
      "x-csrf-token": binding.csrfToken,
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  }));
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("fa_presession=");
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  return cookieValue(response, "fa_session");
}

async function sessionBinding(session: string): Promise<string> {
  const response = await getCsrf(request("/api/v1/auth/csrf", { headers: { cookie: `fa_session=${session}` } }));
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  return (await response.json()).csrfToken as string;
}

function logoutRequest(session: string, token: string): Request {
  return request("/api/v1/auth/logout", {
    method: "POST",
    headers: { origin: ORIGIN, cookie: `fa_session=${session}`, "x-csrf-token": token },
  });
}

async function expectCsrfFailure(response: Response): Promise<void> {
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: {
      code: "csrf_failed",
      message: "The request failed CSRF validation.",
      requestId: response.headers.get("x-request-id"),
    },
  });
}

describe("D-14 CSRF route boundary — PostgreSQL", () => {
  let owner: Awaited<ReturnType<typeof connectAsOwner>>;

  beforeAll(async () => {
    owner = await connectAsOwner();
    expect(database).not.toBeNull();
    expect(csrfService).not.toBeNull();
    expect(accountStatusService).not.toBeNull();
  });

  afterAll(async () => {
    await owner.end();
  });

  it("returns the same safe 403 for every anonymous CSRF and Origin failure", async () => {
    const binding = await anonymousBinding();
    const otherBinding = await anonymousBinding();
    const expiredAt = new Date(Date.now() - 8 * 60 * 60 * 1000);
    const expiredPreAt = new Date(Date.now() - 31 * 60 * 1000);
    const expiredPre = csrfService!.issuePreSession(expiredPreAt).value;
    const wrongSignatureToken = `${binding.csrfToken.slice(0, -1)}${binding.csrfToken.endsWith("A") ? "B" : "A"}`;
    const validBody = JSON.stringify({ email: "absent@example.test", password: PASSWORD });
    const baseHeaders = {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_presession=${binding.preSession}`,
      "x-csrf-token": binding.csrfToken,
    };
    const cases: ReadonlyArray<{ readonly label: string; readonly headers: Record<string, string> }> = [
      { label: "missing token", headers: { ...baseHeaders, "x-csrf-token": "" } },
      { label: "expired token", headers: { ...baseHeaders, "x-csrf-token": csrfService!.issueToken(binding.preSession, expiredAt) } },
      { label: "malformed token", headers: { ...baseHeaders, "x-csrf-token": "csrf_v1.malformed" } },
      { label: "wrong pre-session", headers: { ...baseHeaders, "x-csrf-token": otherBinding.csrfToken } },
      { label: "wrong signature", headers: { ...baseHeaders, "x-csrf-token": wrongSignatureToken } },
      { label: "expired pre-session", headers: { ...baseHeaders, cookie: `fa_presession=${expiredPre}`, "x-csrf-token": csrfService!.issueToken(expiredPre) } },
      { label: "malformed pre-session", headers: { ...baseHeaders, cookie: "fa_presession=pre_v1.malformed" } },
      { label: "wrong Origin", headers: { ...baseHeaders, origin: "https://evil.example" } },
      { label: "missing Origin", headers: { ...baseHeaders, origin: "" } },
    ];

    for (const testCase of cases) {
      const response = await login(request("/api/v1/auth/login", { method: "POST", headers: testCase.headers, body: validBody }));
      await expectCsrfFailure(response);
    }
  });

  it("invalidates session-bound CSRF use after logout, expiry, suspension, and revocation", async () => {
    const logoutAccount = await registration("csrf-logout@example.test");
    const logoutSession = await loginSession("csrf-logout@example.test");
    const logoutToken = await sessionBinding(logoutSession);
    expect((await logout(logoutRequest(logoutSession, logoutToken))).status).toBe(204);
    expect((await logout(logoutRequest(logoutSession, logoutToken))).status).toBe(401);
    expect(logoutAccount).toBeTruthy();

    const expiryAccount = await registration("csrf-expiry@example.test");
    const expirySession = await loginSession("csrf-expiry@example.test");
    const expiryToken = await sessionBinding(expirySession);
    await owner.query("UPDATE app.session SET expires_at = now() - interval '1 second' WHERE account_id = $1", [expiryAccount]);
    expect((await logout(logoutRequest(expirySession, expiryToken))).status).toBe(401);

    const suspendedAccount = await registration("csrf-suspended@example.test");
    const suspendedSession = await loginSession("csrf-suspended@example.test");
    const suspendedToken = await sessionBinding(suspendedSession);
    await database!.withTransaction(async (tx) => {
      const locked = await accountStatusService!.lockUserAccount(tx, suspendedAccount);
      if (!locked.ok) throw new Error("suspension fixture was not lockable");
      await accountStatusService!.suspend(tx, locked.value);
    });
    expect((await logout(logoutRequest(suspendedSession, suspendedToken))).status).toBe(401);

    const revokedAccount = await registration("csrf-revoked@example.test");
    const revokedSession = await loginSession("csrf-revoked@example.test");
    const revokedToken = await sessionBinding(revokedSession);
    const sessionService = createSessionService({
      database: database!,
      sessionRepository: createSessionRepository({ sql: database! }),
      sessionTtlSeconds: 8 * 60 * 60,
    });
    await sessionService.revokeAccount(revokedAccount);
    expect((await logout(logoutRequest(revokedSession, revokedToken))).status).toBe(401);
  });
});
