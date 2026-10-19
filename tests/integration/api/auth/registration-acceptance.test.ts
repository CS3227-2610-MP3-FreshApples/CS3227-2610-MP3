import { Client } from "pg";
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
const { GET: csrf } = await import("../../../../src/app/api/v1/auth/csrf/route");

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

async function registrationResponse(body: unknown): Promise<Response> {
  const csrfResponse = await csrf(request("/api/v1/auth/csrf"));
  const preSession = cookieValue(csrfResponse, "fa_presession");
  const token = (await csrfResponse.json()).csrfToken as string;
  return register(request("/api/v1/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_presession=${preSession}`,
      "x-csrf-token": token,
    },
    body: JSON.stringify(body),
  }));
}

async function accountCount(): Promise<number> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM app.account");
    return result.rows[0]?.count ?? 0;
  } finally {
    await client.end();
  }
}

async function storedAccounts(): Promise<Array<{ normalized_email: string; password_hash: string; role: string; status: string }>> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ normalized_email: string; password_hash: string; role: string; status: string }>(
      "SELECT normalized_email, password_hash, role, status FROM app.account ORDER BY normalized_email",
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

describe("registration acceptance — real Route Handler and PostgreSQL", () => {
  beforeAll(() => {
    expect(process.env.DATABASE_URL).toBe(testDatabaseUrl());
  });

  it("rejects a malformed domain without creating an account", async () => {
    const before = await accountCount();
    const response = await registrationResponse({
      email: "person@example_com",
      password: "Correct-password1!",
      displayName: "Malformed Domain",
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: "validation_failed",
      fieldErrors: { email: ["invalid email"] },
    });
    expect(await accountCount()).toBe(before);
  });

  it.each(["role", "status"] as const)("rejects an injected %s with no account write", async (field) => {
    const before = await accountCount();
    const response = await registrationResponse({
      email: `${field}@example.test`,
      password: "Correct-password1!",
      displayName: `Injected ${field}`,
      [field]: field === "role" ? "ADMIN" : "suspended",
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: "validation_failed",
      fieldErrors: { [field]: ["unrecognized key"] },
    });
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
    expect(await accountCount()).toBe(before);
  });

  it("maps one normalized identity to a safe conflict and persists only an active USER", async () => {
    const originalFirst = " \tU\u0308ser@EXÄMPLE.com\r\n";
    const originalSecond = "üSER@xn--exmple-cua.com";
    const created = await registrationResponse({
      email: originalFirst,
      password: "Correct-password1!",
      displayName: "First Identity",
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ role: "USER", status: "active" });

    const duplicate = await registrationResponse({
      email: originalSecond,
      password: "Another-password2!",
      displayName: "Duplicate Identity",
    });
    expect(duplicate.status).toBe(409);
    const duplicateText = await duplicate.text();
    expect(JSON.parse(duplicateText).error).toMatchObject({
      code: "conflict",
      message: "The request conflicts with the current state.",
    });
    expect(duplicateText).not.toContain(originalFirst.trim());
    expect(duplicateText).not.toContain(originalSecond);
    expect(duplicateText).not.toMatch(/23505|duplicate key|app\.account|normalized_email/i);

    const stored = await storedAccounts();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      normalized_email: "üser@xn--exmple-cua.com",
      role: "USER",
      status: "active",
    });
    expect(stored[0]!.password_hash).toMatch(/^\$argon2id\$/);
    expect(stored[0]!.password_hash).not.toContain("Correct-password1!");
    expect(stored[0]!.password_hash).not.toContain("Another-password2!");
  });
});
