import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAuthGuards } from "../../../src/server/services/identity/guards";
import { createAccountStatusService } from "../../../src/server/services/identity/account-status";
import { createRecordingSecurityLog } from "../../support/fakes/security-log";
import type { AccountId, RowVersion, SessionId, Tx } from "../../../src/server/shared";

const tx = {} as Tx;
const accountId = "00000000-0000-4000-8000-000000000001" as AccountId;
const sessionId = "00000000-0000-4000-8000-000000000002" as SessionId;

function guardsFor(auth: unknown, csrf = { verifyOrigin: vi.fn(), verifyToken: vi.fn() }) {
  return createAuthGuards({ authService: auth as never, csrfService: csrf, securityLog: createRecordingSecurityLog(), cronSecret: "cron-secret", publicAppUrl: "https://app.example.test", hosted: true });
}

describe("authorization guards", () => {
  it("rechecks the current account status on every request and rejects a suspended user", async () => {
    const auth = {
      resolveSession: vi.fn()
        .mockResolvedValueOnce({ account: { id: accountId, displayName: "Person", role: "USER", status: "active", version: 1 }, sessionId })
        .mockResolvedValueOnce({ account: { id: accountId, displayName: "Person", role: "USER", status: "suspended", version: 2 }, sessionId }),
    };
    const guards = guardsFor(auth);
    const request = new Request("https://app.example.test/app", { headers: { cookie: "__Host-fa_session=session-token" } });

    await expect(guards.requireActiveUser(request)).resolves.toEqual({ ok: true, value: { accountId, sessionId, role: "USER" } });
    await expect(guards.requireActiveUser(request)).resolves.toEqual({ ok: false, error: { kind: "forbidden" } });
    expect(auth.resolveSession).toHaveBeenCalledTimes(2);
  });

  it("requires an active Admin role and CSRF/origin checks for Admin mutations", async () => {
    const auth = { resolveSession: vi.fn().mockResolvedValue({ account: { id: accountId, displayName: "Admin", role: "ADMIN", status: "active", version: 1 }, sessionId }) };
    const csrf = { verifyOrigin: vi.fn().mockReturnValue(true), verifyToken: vi.fn().mockReturnValue(true) };
    const guards = createAuthGuards({ authService: auth as never, csrfService: csrf, securityLog: createRecordingSecurityLog(), cronSecret: "cron-secret", publicAppUrl: "https://app.example.test", hosted: true });
    const request = new Request("https://app.example.test/admin", { method: "POST", headers: { cookie: "__Host-fa_session=session-token", origin: "https://app.example.test", "x-csrf-token": "csrf-token" } });

    await expect(guards.requireActiveAdminMutation(request)).resolves.toEqual({ ok: true, value: { accountId, sessionId, role: "ADMIN" } });
    expect(csrf.verifyOrigin).toHaveBeenCalledWith("https://app.example.test", "https://app.example.test");
    expect(csrf.verifyToken).toHaveBeenCalledWith("csrf-token", sessionId);
  });

  it("composes a hosted-cookie guard with a consumer without exposing session data", async () => {
    const auth = { resolveSession: vi.fn().mockResolvedValue({ account: { id: accountId, displayName: "Admin", role: "ADMIN", status: "active", version: 1 }, sessionId }) };
    const guards = createAuthGuards({
      authService: auth as never,
      csrfService: { verifyOrigin: vi.fn(), verifyToken: vi.fn() },
      securityLog: createRecordingSecurityLog(),
      cronSecret: "cron-secret",
      publicAppUrl: "https://app.example.test",
      hosted: true,
    });
    const consumer = async (request: Request) => {
      const principal = await guards.requireActiveAdmin(request);
      return principal.ok ? { ok: true, accountId: principal.value.accountId } : principal;
    };

    await expect(consumer(new Request("https://app.example.test/admin", { headers: { cookie: "__Host-fa_session=session-token" } }))).resolves.toEqual({ ok: true, accountId });
  });

  it("records safe access.denied events for authorization failures", async () => {
    const securityLog = createRecordingSecurityLog();
    const guards = createAuthGuards({
      authService: { resolveSession: vi.fn().mockResolvedValue({ account: { id: accountId, displayName: "Person", role: "USER", status: "active", version: 1 }, sessionId }) },
      csrfService: { verifyOrigin: vi.fn().mockReturnValue(false), verifyToken: vi.fn() },
      securityLog,
      cronSecret: "cron-secret",
      publicAppUrl: "https://app.example.test",
      hosted: true,
    });

    const requestId = "00000000-0000-4000-8000-000000000003";
    await expect(guards.requireActiveAdminMutation(new Request("https://app.example.test/admin", { method: "POST", headers: { cookie: "__Host-fa_session=session-token", "x-request-id": requestId } }))).resolves.toEqual({ ok: false, error: { kind: "forbidden" } });
    expect(securityLog.records).toMatchObject([{ event: "access.denied", outcome: "denied", requestId, actorId: accountId, code: "forbidden" }]);
  });

  it.each([
    [undefined, "missing"],
    ["Bearer wrong", "invalid"],
    ["Bearer cron-secret extra", "extra credentials"],
    ["Bearer cron-secret", "admin session is irrelevant"],
  ])("validates cron credentials strictly (%s)", (authorization, label) => {
    const guards = guardsFor({ resolveSession: vi.fn() });
    const headers: Record<string, string> = authorization === undefined ? {} : { authorization, cookie: "__Host-fa_session=admin-session" };
    const result = guards.requireCronCaller(new Request("https://app.example.test/internal/cron", { headers }));
    if (label === "admin session is irrelevant") expect(result).toEqual({ ok: true, value: undefined });
    else expect(result).toEqual({ ok: false, error: { kind: "unauthenticated" } });
  });

  it.each([
    [undefined, "no header"],
    ["Bearer ", "empty bearer"],
    ["Bearer", "bare scheme"],
    ["Basic ", "empty basic"],
    ["Bearer x", "any credential"],
  ])("rejects every cron caller when CRON_SECRET is not configured (%s, D-98)", (authorization, label) => {
    const guards = createAuthGuards({ authService: { resolveSession: vi.fn() }, csrfService: { verifyOrigin: vi.fn(), verifyToken: vi.fn() }, securityLog: createRecordingSecurityLog(), cronSecret: "", publicAppUrl: "https://app.example.test", hosted: true });
    const headers: Record<string, string> = authorization === undefined ? {} : { authorization };
    expect(guards.requireCronCaller(new Request("https://app.example.test/internal/cron", { headers })), label).toEqual({ ok: false, error: { kind: "unauthenticated" } });
  });
});

describe("Identity account status", () => {
  it.each([
    { role: "ADMIN", label: "Admin" },
    { role: undefined, label: "missing-role" },
    { role: "MODERATOR", label: "invalid-role" },
  ])("denies $label account-lock data as a USER status target", async ({ role }) => {
    const service = createAccountStatusService({
      accountRepository: {
        lockById: vi.fn().mockResolvedValue({
          accountId,
          role,
          status: "active",
          version: 1 as RowVersion,
          strikeCycle: 0,
        }),
        updateStatus: vi.fn(),
      } as never,
      sessionRepository: { deleteByAccountId: vi.fn() },
    });

    await expect(service.lockUserAccount(tx, accountId)).resolves.toEqual({
      ok: false,
      error: { kind: "not_user_target" },
    });
  });

  it("suspends atomically with session revocation and reinstates with a new strike cycle", async () => {
    const calls: string[] = [];
    const accountRepository = {
      updateStatus: vi.fn(async (_tx: Tx, _account: unknown, status: "active" | "suspended", strikeCycle: number) => { calls.push("account"); return { status, version: 2 as RowVersion, strikeCycle }; }),
    };
    const sessions = { deleteByAccountId: vi.fn(async () => { calls.push("sessions"); }) };
    const service = createAccountStatusService({ accountRepository: accountRepository as never, sessionRepository: sessions as never });
    const locked = { accountId, role: "USER" as const, status: "active" as const, version: 1 as RowVersion, strikeCycle: 0, } as never;

    await expect(service.suspend(tx, locked)).resolves.toEqual({ accountId, before: "active", after: "suspended", version: 2, strikeCycle: 0, changed: true });
    expect(calls).toEqual(["account", "sessions"]);
    await expect(service.reinstate(tx, { accountId, role: "USER", status: "suspended", version: 2 as RowVersion, strikeCycle: 0 } as never)).resolves.toEqual({ accountId, before: "suspended", after: "active", version: 2, strikeCycle: 1, changed: true });
  });
});
