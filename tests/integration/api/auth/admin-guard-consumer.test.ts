import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

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

const { GET: csrf } = await import("../../../../src/app/api/v1/auth/csrf/route");
const { POST: register } = await import("../../../../src/app/api/v1/auth/register/route");
const { POST: login } = await import("../../../../src/app/api/v1/auth/login/route");
const { authGuards, firstAdminBootstrapService } = await import("../../../../src/server/composition");
import { errorResponse, runRoute } from "../../../../src/server/http";
import { response } from "../../../../src/app/api/v1/auth/http";
import { connectAsOwner } from "../../database/schema-fixtures";

const ORIGIN = "http://localhost:3000";
const USER_PASSWORD = "User-password1!";
const ADMIN_PASSWORD = "Admin-password1!";
let adminMutationCount = 0;

function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function cookieValue(result: Response, name: string): string {
  const match = (result.headers.get("set-cookie") ?? "").match(new RegExp(`${name}=([^;]*)`));
  if (match?.[1] === undefined || match[1] === "") throw new Error(`missing ${name} cookie`);
  return match[1];
}

async function loginWithCsrf(email: string, password: string): Promise<string> {
  const csrfResponse = await csrf(request("/api/v1/auth/csrf"));
  const preSession = cookieValue(csrfResponse, "fa_presession");
  const csrfToken = (await csrfResponse.json()).csrfToken as string;
  const loginResponse = await login(request("/api/v1/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_presession=${preSession}`,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({ email, password }),
  }));
  expect(loginResponse.status).toBe(200);
  return cookieValue(loginResponse, "fa_session");
}

const adminOnlyConsumer = runRoute(async (request, id) => {
  if (authGuards === null) return errorResponse({ kind: "unavailable" }, id);
  const principal = await authGuards.requireActiveAdmin(request);
  if (!principal.ok) return errorResponse(principal.error, id);
  adminMutationCount += 1;
  return response({ ok: true, mutationCount: adminMutationCount }, 200);
});

describe("Admin-only guard consumer — PostgreSQL", () => {
  let owner: Awaited<ReturnType<typeof connectAsOwner>>;

  beforeAll(async () => {
    owner = await connectAsOwner();
    expect(firstAdminBootstrapService).not.toBeNull();
    await firstAdminBootstrapService!.bootstrap({
      email: "guard-admin@example.test",
      password: ADMIN_PASSWORD,
      requestId: randomUUID() as never,
    });

    const registrationResponse = await register(request("/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email: "guard-user@example.test", password: USER_PASSWORD, displayName: "Guard User" }),
    }));
    expect(registrationResponse.status).toBe(403);

    const csrfResponse = await csrf(request("/api/v1/auth/csrf"));
    const preSession = cookieValue(csrfResponse, "fa_presession");
    const csrfToken = (await csrfResponse.json()).csrfToken as string;
    const registered = await register(request("/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie: `fa_presession=${preSession}`, "x-csrf-token": csrfToken },
      body: JSON.stringify({ email: "guard-user@example.test", password: USER_PASSWORD, displayName: "Guard User" }),
    }));
    expect(registered.status).toBe(201);
  });

  afterAll(async () => {
    await owner.end();
  });

  beforeEach(() => {
    adminMutationCount = 0;
  });

  it("denies an unauthenticated request without mutation", async () => {
    const unauthenticatedResponse = await adminOnlyConsumer(request("/api/v1/admin-only"));
    expect(unauthenticatedResponse.status).toBe(401);
    expect(adminMutationCount).toBe(0);
  });

  it("denies an active USER without mutation", async () => {
    const userSession = await loginWithCsrf("guard-user@example.test", USER_PASSWORD);
    const userResponse = await adminOnlyConsumer(request("/api/v1/admin-only", { headers: { cookie: `fa_session=${userSession}` } }));
    expect(userResponse.status).toBe(403);
    expect(adminMutationCount).toBe(0);
  });

  it("denies a suspended USER without mutation", async () => {
    const userSession = await loginWithCsrf("guard-user@example.test", USER_PASSWORD);
    try {
      await owner.query("UPDATE app.account SET status = 'suspended', version = version + 1 WHERE normalized_email = $1", ["guard-user@example.test"]);
      const suspendedResponse = await adminOnlyConsumer(request("/api/v1/admin-only", { headers: { cookie: `fa_session=${userSession}` } }));
      expect(suspendedResponse.status).toBe(403);
      expect(adminMutationCount).toBe(0);
    } finally {
      await owner.query("UPDATE app.account SET status = 'active', version = version + 1 WHERE normalized_email = $1", ["guard-user@example.test"]);
    }
  });

  it("allows an active ADMIN to mutate", async () => {
    const adminSession = await loginWithCsrf("guard-admin@example.test", ADMIN_PASSWORD);
    const activeAdminResponse = await adminOnlyConsumer(request("/api/v1/admin-only", { headers: { cookie: `fa_session=${adminSession}` } }));
    expect(activeAdminResponse.status).toBe(200);
    await expect(activeAdminResponse.json()).resolves.toEqual({ ok: true, mutationCount: 1 });
    expect(adminMutationCount).toBe(1);
  });

  it("re-reads role and status for the same ADMIN session before each mutation", async () => {
    const adminSession = await loginWithCsrf("guard-admin@example.test", ADMIN_PASSWORD);
    try {
      const activeAdminResponse = await adminOnlyConsumer(request("/api/v1/admin-only", { headers: { cookie: `fa_session=${adminSession}` } }));
      expect(activeAdminResponse.status).toBe(200);
      await expect(activeAdminResponse.json()).resolves.toEqual({ ok: true, mutationCount: 1 });
      expect(adminMutationCount).toBe(1);

      await owner.query("UPDATE app.account SET role = 'USER', version = version + 1 WHERE normalized_email = $1", ["guard-admin@example.test"]);
      const changedRoleResponse = await adminOnlyConsumer(request("/api/v1/admin-only", { headers: { cookie: `fa_session=${adminSession}` } }));
      expect(changedRoleResponse.status).toBe(403);
      expect(adminMutationCount).toBe(1);

      await owner.query("UPDATE app.account SET role = 'ADMIN', status = 'suspended', version = version + 1 WHERE normalized_email = $1", ["guard-admin@example.test"]);
      const changedStatusResponse = await adminOnlyConsumer(request("/api/v1/admin-only", { headers: { cookie: `fa_session=${adminSession}` } }));
      expect(changedStatusResponse.status).toBe(403);
      expect(adminMutationCount).toBe(1);
    } finally {
      await owner.query("UPDATE app.account SET role = 'ADMIN', status = 'active', version = version + 1 WHERE normalized_email = $1", ["guard-admin@example.test"]);
    }
  });
});
