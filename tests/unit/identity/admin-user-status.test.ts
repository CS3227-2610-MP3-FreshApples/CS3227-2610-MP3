import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAdminUserService, parseAdminUserStatusInput } from "../../../src/server/services/identity";
import type { AccountStatusService } from "../../../src/server/services/identity";
import type { AdminUserRepository } from "../../../src/server/repositories/identity";
import type { AuditLog } from "../../../src/server/services/audit";
import type { Database } from "../../../src/server/db";
import type { AccountId, RequestId, RowVersion, SessionId, Tx } from "../../../src/server/shared";
import type { Principal } from "../../../src/server/services/identity";

const ADMIN: Principal = { accountId: "00000000-0000-4000-8000-000000000001" as AccountId, sessionId: "session" as SessionId, role: "ADMIN" };
const USER_ID = "00000000-0000-4000-8000-000000000002" as AccountId;
const tx = {} as Tx;

function database(): Pick<Database, "withTransaction" | "withTransactionResult"> {
  return {
    withTransaction: async <T>(work: (transaction: Tx) => Promise<T>) => work(tx),
    withTransactionResult: async <T, E>(work: (transaction: Tx) => Promise<{ ok: true; value: T } | { ok: false; error: E }>) => work(tx),
  };
}

describe("A-06 status mutation", () => {
  it("validates the strict status body and reason bounds", () => {
    expect(parseAdminUserStatusInput({ status: "suspended", reason: "  Repeated abuse  " })).toEqual({
      ok: true,
      value: { status: "suspended", reason: "Repeated abuse" },
    });
    expect(parseAdminUserStatusInput({ status: "active", reason: "short" })).toEqual({
      ok: false,
      error: { reason: ["must be 10 to 1,000 characters"] },
    });
    expect(parseAdminUserStatusInput({ status: "active", reason: "A sufficiently long reason", extra: true })).toEqual({
      ok: false,
      error: { extra: ["unrecognized key"] },
    });
  });

  it("locks through K4, records K5, and returns the safe updated projection", async () => {
    const users: AdminUserRepository = {
      count: vi.fn(),
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue({ id: USER_ID, displayName: "Alice", status: "suspended", version: 2 }),
    };
    const status: Pick<AccountStatusService, "lockUserAccountAtVersion" | "suspend" | "reinstate"> = {
      lockUserAccountAtVersion: vi.fn().mockResolvedValue({ ok: true, value: { accountId: USER_ID, status: "active", version: 1, strikeCycle: 0 } }),
      suspend: vi.fn().mockResolvedValue({ accountId: USER_ID, before: "active", after: "suspended", version: 2, strikeCycle: 0, changed: true }),
      reinstate: vi.fn(),
    };
    const audit: AuditLog = { record: vi.fn() };
    const service = createAdminUserService({ database: database(), users, accountStatus: status, auditLog: audit });

    const result = await service.updateStatus(ADMIN, USER_ID, 1 as RowVersion, { status: "suspended", reason: "Repeated abuse" }, "request" as RequestId);

    expect(result).toEqual({ ok: true, value: { id: USER_ID, displayName: "Alice", status: "suspended", version: 2 } });
    expect(status.lockUserAccountAtVersion).toHaveBeenCalledWith(tx, USER_ID, 1);
    expect(status.suspend).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "account.suspend", result: "applied", targetId: USER_ID }));
  });

  it("maps stale versions and Admin targets without mutating or auditing", async () => {
    const users: AdminUserRepository = { count: vi.fn(), list: vi.fn(), findById: vi.fn() };
    const status: Pick<AccountStatusService, "lockUserAccountAtVersion" | "suspend" | "reinstate"> = {
      lockUserAccountAtVersion: vi.fn().mockResolvedValue({ ok: false, error: { kind: "stale_version" } }),
      suspend: vi.fn(),
      reinstate: vi.fn(),
    };
    const audit: AuditLog = { record: vi.fn() };
    const service = createAdminUserService({ database: database(), users, accountStatus: status, auditLog: audit });

    await expect(service.updateStatus(ADMIN, USER_ID, 99 as RowVersion, { status: "active", reason: "Correct mistaken suspension" }, "request" as RequestId))
      .resolves.toEqual({ ok: false, error: { kind: "stale_version" } });
    expect(audit.record).not.toHaveBeenCalled();

    vi.mocked(status.lockUserAccountAtVersion).mockResolvedValue({ ok: false, error: { kind: "not_user_target" } });
    await expect(service.updateStatus(ADMIN, USER_ID, 99 as RowVersion, { status: "suspended", reason: "Administrative restriction" }, "request" as RequestId))
      .resolves.toEqual({ ok: false, error: { kind: "forbidden" } });
  });

  it("records a no-op audit without advancing the returned version", async () => {
    const users: AdminUserRepository = {
      count: vi.fn(),
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue({ id: USER_ID, displayName: "Alice", status: "suspended", version: 2 }),
    };
    const status: Pick<AccountStatusService, "lockUserAccountAtVersion" | "suspend" | "reinstate"> = {
      lockUserAccountAtVersion: vi.fn().mockResolvedValue({ ok: true, value: { accountId: USER_ID, status: "suspended", version: 2, strikeCycle: 1 } }),
      suspend: vi.fn().mockResolvedValue({ accountId: USER_ID, before: "suspended", after: "suspended", version: 2, strikeCycle: 1, changed: false }),
      reinstate: vi.fn(),
    };
    const audit: AuditLog = { record: vi.fn() };
    const service = createAdminUserService({ database: database(), users, accountStatus: status, auditLog: audit });

    await expect(service.updateStatus(ADMIN, USER_ID, 2 as RowVersion, { status: "suspended", reason: "Keep current suspension" }, "request" as RequestId))
      .resolves.toEqual({ ok: true, value: { id: USER_ID, displayName: "Alice", status: "suspended", version: 2 } });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "account.suspend", result: "no_op" }));
  });
});
