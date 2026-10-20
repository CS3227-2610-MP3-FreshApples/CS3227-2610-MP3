import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAuthService } from "../../../src/server/services/identity/auth";
import { hashPassword } from "../../../src/server/services/identity/account";
import type { Database } from "../../../src/server/db";
import type { AccountId, RequestId, Tx } from "../../../src/server/shared";
import type { RateLimitKey } from "../../../src/server/services/rate-limit";
import { createFailClosedRateLimiter } from "../../support/fakes/rate-limiter";
import { createRecordingSecurityLog } from "../../support/fakes/security-log";
import { ServiceUnavailableError } from "../../../src/server/shared";

const tx = {} as Tx;
const accountId = "00000000-0000-4000-8000-000000000001" as AccountId;
const requestId = "00000000-0000-4000-8000-000000000009" as RequestId;
const input = { email: "person@example.com", password: "correct horse battery staple1!" };

function database(): Database { return { withTransaction: async (work) => work(tx), withTransactionResult: async (work) => work(tx), probe: async () => undefined }; }

function dependencies() {
  const limiter = createFailClosedRateLimiter();
  const accountRepository = { findByNormalizedEmail: vi.fn(), findById: vi.fn(), create: vi.fn() };
  const keys = { forEmail: vi.fn((_, value) => `email:${value}` as RateLimitKey), forClientIp: vi.fn((_, value) => `ip:${value}` as RateLimitKey), forAccount: vi.fn(), forEnvironment: vi.fn() };
  const sessions = { create: vi.fn(), resolve: vi.fn(), logout: vi.fn(), revokeAccount: vi.fn() };
  const securityLog = createRecordingSecurityLog();
  return { service: createAuthService({ database: database(), accountRepository, sessions, rateLimiter: limiter, rateLimitKeys: keys, securityLog }), limiter, accountRepository, keys, sessions, securityLog };
}

describe("D-44 login sequence", () => {
  it("checks both limits before reading or verifying credentials", async () => {
    const deps = dependencies();
    const result = await deps.service.login(input, "unknown", requestId);
    expect(result).toEqual({ ok: false, error: { kind: "rate_limited", retryAfterSeconds: 60 } });
    expect(deps.accountRepository.findByNormalizedEmail).not.toHaveBeenCalled();
    expect(deps.sessions.create).not.toHaveBeenCalled();
    expect(deps.limiter.consumed).toHaveLength(0);
  });

  it("consumes both failure limits for invalid credentials and creates a session only for active accounts", async () => {
    const deps = dependencies();
    const passwordHash = await hashPassword(input.password);
    deps.accountRepository.findByNormalizedEmail.mockResolvedValue({ id: accountId, normalizedEmail: input.email, passwordHash, displayName: "Person", role: "USER", status: "active", version: 1 });
    const emailKey = deps.keys.forEmail("login_failure_email", input.email);
    const ipKey = deps.keys.forClientIp("login_failure_ip", "unknown");
    deps.limiter.admit(emailKey); deps.limiter.admit(ipKey);
    deps.accountRepository.findByNormalizedEmail.mockResolvedValueOnce({ id: accountId, normalizedEmail: input.email, passwordHash, displayName: "Person", role: "USER", status: "active", version: 1 });
    const result = await deps.service.login({ ...input, password: "wrong password1!" }, "unknown", requestId);
    expect(result).toEqual({ ok: false, error: { kind: "unauthenticated" } });
    expect(deps.limiter.consumed).toHaveLength(2);
    expect(deps.sessions.create).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown email", null, input.password],
    ["invalid password", { id: accountId, normalizedEmail: input.email, passwordHash: awaitHashPlaceholder(), displayName: "Person", role: "USER", status: "active", version: 1 }, "wrong password1!"],
    ["suspended account", { id: accountId, normalizedEmail: input.email, passwordHash: awaitHashPlaceholder(), displayName: "Person", role: "USER", status: "suspended", version: 1 }, input.password],
  ] as const)("returns the same generic failure and consumes both limits for %s", async (_label, account, password) => {
    const deps = dependencies();
    const passwordHash = await hashPassword(input.password);
    const emailKey = deps.keys.forEmail("login_failure_email", input.email);
    const ipKey = deps.keys.forClientIp("login_failure_ip", "unknown");
    deps.limiter.admit(emailKey); deps.limiter.admit(ipKey);
    deps.accountRepository.findByNormalizedEmail.mockResolvedValue(account === null ? null : { ...account, passwordHash });

    const result = await deps.service.login({ ...input, password }, "unknown", requestId);

    expect(result).toEqual({ ok: false, error: { kind: "unauthenticated" } });
    expect(deps.limiter.consumed).toHaveLength(2);
    expect(deps.sessions.create).not.toHaveBeenCalled();
  });

  it("does not consume or verify credentials when either limit is already full", async () => {
    const deps = dependencies();
    const emailKey = deps.keys.forEmail("login_failure_email", input.email);
    const ipKey = deps.keys.forClientIp("login_failure_ip", "unknown");
    deps.limiter.admit(emailKey); deps.limiter.admit(ipKey);
    for (let i = 0; i < 5; i += 1) {
      await deps.limiter.consume(emailKey, { limit: 5, windowSeconds: 900 }, 1);
    }

    const result = await deps.service.login(input, "unknown", requestId);

    expect(result).toEqual({ ok: false, error: { kind: "rate_limited", retryAfterSeconds: expect.any(Number) } });
    expect(deps.accountRepository.findByNormalizedEmail).not.toHaveBeenCalled();
    expect(deps.limiter.consumed).toHaveLength(5);
  });

  it("records the rejected rate limit and auth throttle against the actual pre-throttled limit", async () => {
    const deps = dependencies();
    const emailKey = deps.keys.forEmail("login_failure_email", input.email);
    const ipKey = deps.keys.forClientIp("login_failure_ip", "unknown");
    deps.limiter.admit(emailKey); deps.limiter.admit(ipKey);
    for (let i = 0; i < 5; i += 1) {
      await deps.limiter.consume(ipKey, { limit: 5, windowSeconds: 900 }, 1);
    }

    await deps.service.login(input, "unknown", requestId);

    expect(deps.securityLog.records.slice(-2)).toEqual([
      expect.objectContaining({ event: "rate_limit.rejected", limit: "login_failure_ip" }),
      expect.objectContaining({ event: "auth.login_throttled", limit: "login_failure_ip" }),
    ]);
  });

  it("lets counters expire naturally and successful active login consumes nothing", async () => {
    const deps = dependencies();
    const passwordHash = await hashPassword(input.password);
    const emailKey = deps.keys.forEmail("login_failure_email", input.email);
    const ipKey = deps.keys.forClientIp("login_failure_ip", "unknown");
    deps.limiter.admit(emailKey); deps.limiter.admit(ipKey);
    deps.accountRepository.findByNormalizedEmail.mockResolvedValue({ id: accountId, normalizedEmail: input.email, passwordHash, displayName: "Person", role: "USER", status: "active", version: 1 });
    deps.sessions.create.mockResolvedValue({ token: "session-token", session: { id: "session-id" } });

    await deps.service.login({ ...input, password: "wrong password1!" }, "unknown", requestId);
    deps.limiter.startNextWindow();
    const result = await deps.service.login(input, "unknown", requestId);

    expect(result.ok).toBe(true);
    expect(deps.limiter.consumed).toHaveLength(2);
    expect(deps.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the limiter database is unavailable", async () => {
    const deps = dependencies();
    const unavailable = { ...deps.limiter, check: vi.fn().mockRejectedValue(new Error("database unavailable")) };
    const service = createAuthService({
      database: database(),
      accountRepository: deps.accountRepository,
      sessions: deps.sessions,
      rateLimiter: unavailable,
      rateLimitKeys: deps.keys,
      securityLog: deps.securityLog,
    });

    await expect(service.login(input, "unknown", requestId)).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});

function awaitHashPlaceholder(): string {
  return "synthetic-password-hash";
}
