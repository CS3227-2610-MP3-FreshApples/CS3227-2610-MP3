import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../src/server/composition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/server/composition")>();
  const { clientIpFromVercelHeaders } = await import("../../../../src/server/http/client-ip");
  return { ...actual, clientIpResolver: clientIpFromVercelHeaders };
});

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

const { POST: login } = await import("../../../../src/app/api/v1/auth/login/route");
const { GET: csrf } = await import("../../../../src/app/api/v1/auth/csrf/route");
const { hashPassword } = await import("../../../../src/server/services/identity/account");

const ORIGIN = "http://localhost:3000";
const CORRECT_PASSWORD = "Correct-password1!";
const WRONG_PASSWORD = "Incorrect-password2!";
const owner = new Client({ connectionString: testDatabaseUrl() });

function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function cookieValue(response: Response, name: string): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`${name}=([^;]*)`));
  if (match?.[1] === undefined || match[1] === "") throw new Error(`missing ${name} cookie`);
  return match[1];
}

async function loginResponse(
  email: string,
  password: string,
  clientIp: string,
  forwardedFor = "198.51.100.200",
): Promise<Response> {
  const csrfResponse = await csrf(request("/api/v1/auth/csrf"));
  const preSession = cookieValue(csrfResponse, "fa_presession");
  const csrfToken = (await csrfResponse.json()).csrfToken as string;
  return login(request("/api/v1/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_presession=${preSession}`,
      "x-csrf-token": csrfToken,
      "x-real-ip": clientIp,
      "x-forwarded-for": forwardedFor,
    },
    body: JSON.stringify({ email, password }),
  }));
}

async function insertAccount(
  email: string,
  status: "active" | "suspended" = "active",
  passwordHash?: string,
): Promise<string> {
  const hash = passwordHash ?? await hashPassword(CORRECT_PASSWORD);
  const result = await owner.query<{ id: string }>(
    `INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
     VALUES ($1, $2, $3, 'USER', $4)
     RETURNING id`,
    [email, hash, email, status],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error("account fixture insert returned no id");
  return id;
}

async function limitCounts(): Promise<Array<{ name: string; count: number }>> {
  const result = await owner.query<{ name: string; count: number }>(
    `SELECT split_part(bucket_key, ':', 1) AS name, count
       FROM app.rate_limit_window
      ORDER BY bucket_key`,
  );
  return result.rows;
}

async function sessionCount(): Promise<number> {
  const result = await owner.query<{ count: number }>("SELECT count(*)::int AS count FROM app.session");
  return result.rows[0]?.count ?? 0;
}

async function expectGenericCredentialFailure(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  const body = await response.json();
  expect(body.error).toMatchObject({
    code: "unauthenticated",
    message: "Authentication is required.",
    requestId: response.headers.get("x-request-id"),
  });
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(JSON.stringify(body)).not.toMatch(/email|password|suspend|account/i);
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBe(testDatabaseUrl());
  await owner.connect();
});

beforeEach(async () => {
  await owner.query("TRUNCATE app.rate_limit_window, app.session, app.account RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await owner.end();
});

describe("SEC-06 login throttling — real Route Handler and PostgreSQL", () => {
  it("admits five failures, then returns 429 with a database-clock Retry-After without another increment", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectGenericCredentialFailure(
        await loginResponse("missing@example.test", WRONG_PASSWORD, "203.0.113.10"),
      );
    }

    expect(await limitCounts()).toEqual([
      { name: "login_failure_email", count: 5 },
      { name: "login_failure_ip", count: 5 },
    ]);
    const throttled = await loginResponse("missing@example.test", WRONG_PASSWORD, "203.0.113.10");
    expect(throttled.status).toBe(429);
    const retryAfter = throttled.headers.get("retry-after");
    expect(retryAfter).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
    expect(Number(retryAfter)).toBeLessThanOrEqual(900);
    expect((await throttled.json()).error).toMatchObject({ code: "rate_limited" });
    expect(await limitCounts()).toEqual([
      { name: "login_failure_email", count: 5 },
      { name: "login_failure_ip", count: 5 },
    ]);
  });

  it("shares the email counter across D-82 normalization variants", async () => {
    const variants = [" \tU\u0308ser@EXÄMPLE.com\r\n", "üSER@xn--exmple-cua.com"];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectGenericCredentialFailure(
        await loginResponse(variants[attempt % variants.length]!, WRONG_PASSWORD, `203.0.113.${20 + attempt}`),
      );
    }

    const throttled = await loginResponse(variants[1]!, WRONG_PASSWORD, "203.0.113.99");
    expect(throttled.status).toBe(429);
    expect((await throttled.json()).error.code).toBe("rate_limited");
  });

  it("isolates real client IPs and ignores spoofed x-forwarded-for values", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectGenericCredentialFailure(await loginResponse(
        `missing-${attempt}@example.test`,
        WRONG_PASSWORD,
        "203.0.113.40",
        `198.51.100.${attempt}`,
      ));
    }

    const sameRealIp = await loginResponse(
      "new-subject@example.test",
      WRONG_PASSWORD,
      "203.0.113.40",
      "192.0.2.250",
    );
    expect(sameRealIp.status).toBe(429);
    await expectGenericCredentialFailure(await loginResponse(
      "new-subject@example.test",
      WRONG_PASSWORD,
      "203.0.113.41",
      "192.0.2.250",
    ));
  });

  it("makes unknown, wrong-password, and correct-password suspended failures indistinguishable and charges both limits", async () => {
    await insertAccount("active@example.test");
    await insertAccount("suspended@example.test", "suspended");

    const responses = [
      await loginResponse("unknown@example.test", CORRECT_PASSWORD, "203.0.113.51"),
      await loginResponse("active@example.test", WRONG_PASSWORD, "203.0.113.52"),
      await loginResponse("suspended@example.test", CORRECT_PASSWORD, "203.0.113.53"),
    ];
    for (const response of responses) await expectGenericCredentialFailure(response);

    expect(await limitCounts()).toEqual([
      { name: "login_failure_email", count: 1 },
      { name: "login_failure_email", count: 1 },
      { name: "login_failure_email", count: 1 },
      { name: "login_failure_ip", count: 1 },
      { name: "login_failure_ip", count: 1 },
      { name: "login_failure_ip", count: 1 },
    ]);
    expect(await sessionCount()).toBe(0);
  });

  it("does not verify credentials or increment either counter once pre-throttled", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectGenericCredentialFailure(
        await loginResponse("prethrottled@example.test", WRONG_PASSWORD, "203.0.113.60"),
      );
    }
    await insertAccount("prethrottled@example.test", "active", "not-an-argon2-hash");

    const response = await loginResponse("prethrottled@example.test", CORRECT_PASSWORD, "203.0.113.60");
    expect(response.status).toBe(429);
    expect(await limitCounts()).toEqual([
      { name: "login_failure_email", count: 5 },
      { name: "login_failure_ip", count: 5 },
    ]);
    expect(await sessionCount()).toBe(0);
  });

  it("creates a session for an active account without creating or consuming failure counters", async () => {
    await insertAccount("success@example.test");
    const response = await loginResponse("success@example.test", CORRECT_PASSWORD, "203.0.113.70");

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("fa_session=");
    expect(await limitCounts()).toEqual([]);
    expect(await sessionCount()).toBe(1);
  });

  it("keeps counters through suspension and reinstatement, then admits again after the fixed window expires", async () => {
    const accountId = await insertAccount("lifecycle@example.test");
    await expectGenericCredentialFailure(
      await loginResponse("lifecycle@example.test", WRONG_PASSWORD, "203.0.113.80"),
    );
    await owner.query("UPDATE app.account SET status = 'suspended', version = version + 1 WHERE id = $1", [accountId]);
    await expectGenericCredentialFailure(
      await loginResponse("lifecycle@example.test", CORRECT_PASSWORD, "203.0.113.80"),
    );
    await owner.query("UPDATE app.account SET status = 'active', version = version + 1, strike_cycle = strike_cycle + 1 WHERE id = $1", [accountId]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expectGenericCredentialFailure(
        await loginResponse("lifecycle@example.test", WRONG_PASSWORD, "203.0.113.80"),
      );
    }

    expect(await limitCounts()).toEqual([
      { name: "login_failure_email", count: 5 },
      { name: "login_failure_ip", count: 5 },
    ]);
    expect((await loginResponse("lifecycle@example.test", CORRECT_PASSWORD, "203.0.113.80")).status).toBe(429);
    expect(await sessionCount()).toBe(0);

    await owner.query("UPDATE app.rate_limit_window SET window_start = window_start - interval '15 minutes'");
    const afterExpiry = await loginResponse("lifecycle@example.test", CORRECT_PASSWORD, "203.0.113.80");
    expect(afterExpiry.status).toBe(200);
    expect(await sessionCount()).toBe(1);
  });

  it("fails closed with a safe 503 when the limiter table is unavailable", async () => {
    await owner.query("ALTER TABLE app.rate_limit_window RENAME TO rate_limit_window_unavailable");
    try {
      const response = await loginResponse("unavailable@example.test", WRONG_PASSWORD, "203.0.113.90");
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(JSON.parse(text).error).toMatchObject({ code: "service_unavailable" });
      expect(text).not.toMatch(/rate_limit_window|relation|postgres|SELECT/i);
    } finally {
      await owner.query("ALTER TABLE app.rate_limit_window_unavailable RENAME TO rate_limit_window");
    }
  });
});
