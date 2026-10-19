import { beforeAll, describe, expect, it, vi } from "vitest";

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

const { POST: register } = await import("../../../../src/app/api/v1/auth/register/route");
const { POST: login } = await import("../../../../src/app/api/v1/auth/login/route");
const { GET: csrf } = await import("../../../../src/app/api/v1/auth/csrf/route");
const { GET: me } = await import("../../../../src/app/api/v1/auth/me/route");
const { POST: logout } = await import("../../../../src/app/api/v1/auth/logout/route");

const ORIGIN = "http://localhost:3000";

function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function cookieValue(response: Response, name: string): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`${name}=([^;]*)`));
  if (match?.[1] === undefined || match[1] === "") throw new Error(`missing ${name} cookie`);
  return match[1];
}

describe("authentication Route Handlers — PostgreSQL journey", () => {
  beforeAll(() => {
    expect(process.env.DATABASE_URL).toBe(testDatabaseUrl());
  });

  it("registers, logs in, reads /me, and logs out through the real composition", async () => {
    const csrfResponse = await csrf(request("/api/v1/auth/csrf"));
    expect(csrfResponse.status).toBe(200);
    const preSession = cookieValue(csrfResponse, "fa_presession");
    const registrationToken = (await csrfResponse.json()).csrfToken as string;

    const registrationResponse = await register(request("/api/v1/auth/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        cookie: `fa_presession=${preSession}`,
        "x-csrf-token": registrationToken,
      },
      body: JSON.stringify({ email: "journey@example.test", password: "Correct-password1!", displayName: "Journey User" }),
    }));
    expect(registrationResponse.status).toBe(201);
    const registrationBody = await registrationResponse.text();
    expect(registrationBody).not.toContain("journey@example.test");
    expect(registrationBody).not.toContain("Correct-password1!");

    const loginCsrfResponse = await csrf(request("/api/v1/auth/csrf"));
    const loginPreSession = cookieValue(loginCsrfResponse, "fa_presession");
    const loginToken = (await loginCsrfResponse.json()).csrfToken as string;
    const loginResponse = await login(request("/api/v1/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        cookie: `fa_presession=${loginPreSession}`,
        "x-csrf-token": loginToken,
      },
      body: JSON.stringify({ email: "journey@example.test", password: "Correct-password1!" }),
    }));
    expect(loginResponse.status).toBe(200);
    const session = cookieValue(loginResponse, "fa_session");
    const loginBody = await loginResponse.text();
    expect(loginBody).not.toContain("journey@example.test");
    expect(loginBody).not.toContain("Correct-password1!");
    expect(loginBody).not.toContain(session);

    const meResponse = await me(request("/api/v1/auth/me", { headers: { cookie: `fa_session=${session}` } }));
    expect(meResponse.status).toBe(200);
    expect(await meResponse.json()).toMatchObject({ displayName: "Journey User", role: "USER", status: "active" });

    const logoutCsrfResponse = await csrf(request("/api/v1/auth/csrf", { headers: { cookie: `fa_session=${session}` } }));
    const logoutToken = (await logoutCsrfResponse.json()).csrfToken as string;
    const logoutResponse = await logout(request("/api/v1/auth/logout", {
      method: "POST",
      headers: { origin: ORIGIN, cookie: `fa_session=${session}`, "x-csrf-token": logoutToken },
    }));
    expect(logoutResponse.status).toBe(204);

    expect((await me(request("/api/v1/auth/me", { headers: { cookie: `fa_session=${session}` } }))).status).toBe(401);
  });
});
