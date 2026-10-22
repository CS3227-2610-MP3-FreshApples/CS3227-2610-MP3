import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { testDatabaseUrl } from "../database/test-database";

process.env.APP_ENV = "test";
process.env.PUBLIC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = "synthetic-session-secret-012345678901234567890123456789";
process.env.RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-012345678901234567890123456789";
delete process.env.DATABASE_CA_CERT;

const { GET: getCsrf } = await import("../../../src/app/api/v1/auth/csrf/route");
const { POST: register } = await import("../../../src/app/api/v1/auth/register/route");
const { POST: login } = await import("../../../src/app/api/v1/auth/login/route");
const { GET: listMovies } = await import("../../../src/app/api/v1/admin/movies/route");
const { GET: listReports } = await import("../../../src/app/api/v1/admin/reports/route");
const { GET: listUsers } = await import("../../../src/app/api/v1/admin/users/route");

const ORIGIN = "http://localhost:3000";

function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function cookieValue(response: Response, name: string): string {
  const match = (response.headers.get("set-cookie") ?? "").match(new RegExp(`${name}=([^;]*)`));
  if (match?.[1] === undefined || match[1] === "") throw new Error(`missing ${name} cookie`);
  return match[1];
}

async function registerAndSignIn(): Promise<string> {
  const email = `${randomUUID()}@example.test`;
  const password = "Access-matrix1!";
  const registrationCsrf = await getCsrf(request("/api/v1/auth/csrf"));
  const preSession = cookieValue(registrationCsrf, "fa_presession");
  const registration = await register(request("/api/v1/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_presession=${preSession}`,
      "x-csrf-token": (await registrationCsrf.json()).csrfToken as string,
    },
    body: JSON.stringify({ email, password, displayName: "Matrix User" }),
  }));
  expect(registration.status).toBe(201);

  const loginCsrf = await getCsrf(request("/api/v1/auth/csrf"));
  const loginResponse = await login(request("/api/v1/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_presession=${cookieValue(loginCsrf, "fa_presession")}`,
      "x-csrf-token": (await loginCsrf.json()).csrfToken as string,
    },
    body: JSON.stringify({ email, password }),
  }));
  expect(loginResponse.status).toBe(200);
  return cookieValue(loginResponse, "fa_session");
}

describe("A#11 User-to-Admin API access matrix", () => {
  beforeAll(() => expect(process.env.DATABASE_URL).toBe(testDatabaseUrl()));

  it("denies an active USER before Admin reads are performed", async () => {
    const session = await registerAndSignIn();
    const headers = { cookie: `fa_session=${session}` };
    const responses = await Promise.all([
      listMovies(request("/api/v1/admin/movies", { headers })),
      listReports(request("/api/v1/admin/reports", { headers })),
      listUsers(request("/api/v1/admin/users", { headers })),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    for (const response of responses) {
      expect((await response.json()).error.code).toBe("forbidden");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});
