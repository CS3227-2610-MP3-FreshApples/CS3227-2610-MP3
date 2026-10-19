import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFirstAdminBootstrapService } from "../../../src/server/services/identity/bootstrap";
import type { Database } from "../../../src/server/db";
import type { RequestId } from "../../../src/server/shared";

const tx = {} as never;

describe("first-Admin bootstrap", () => {
  it("creates one audited Admin in the Identity transaction and becomes a no-op after success", async () => {
    const database = {
      withTransaction: vi.fn(async <T>(work: (transaction: never) => Promise<T>): Promise<T> => work(tx)),
    } as unknown as Pick<Database, "withTransaction">;
    const accounts = {
      lockAccountTableForFirstAdmin: vi.fn().mockResolvedValue(undefined),
      countAdmins: vi.fn().mockResolvedValue(0),
      createAdmin: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          id: "00000000-0000-4000-8000-000000000001",
          normalizedEmail: "admin@example.com",
          passwordHash: "argon2id-hash",
          displayName: "Admin",
          role: "ADMIN",
          status: "active",
          version: 1,
          strikeCycle: 0,
        },
      }),
    };
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) };
    const service = createFirstAdminBootstrapService({
      database,
      accountRepository: accounts,
      auditLog,
    });

    await expect(
      service.bootstrap({
        email: "admin@example.com",
        password: "Synthetic-admin-password1!",
        requestId: "00000000-0000-4000-8000-000000000002" as RequestId,
      }),
    ).resolves.toEqual({ ok: true, status: "created" });

    expect(database.withTransaction).toHaveBeenCalledTimes(1);
    expect(accounts.lockAccountTableForFirstAdmin).toHaveBeenCalledWith(tx);
    expect(accounts.lockAccountTableForFirstAdmin.mock.invocationCallOrder[0]).toBeLessThan(
      accounts.countAdmins.mock.invocationCallOrder[0]!,
    );
    expect(accounts.countAdmins.mock.invocationCallOrder[0]).toBeLessThan(
      accounts.createAdmin.mock.invocationCallOrder[0]!,
    );
    expect(accounts.createAdmin.mock.invocationCallOrder[0]).toBeLessThan(
      auditLog.record.mock.invocationCallOrder[0]!,
    );
    expect(accounts.createAdmin).toHaveBeenCalledWith(tx, {
      normalizedEmail: "admin@example.com",
      passwordHash: expect.any(String),
      displayName: "Admin",
    });
    expect(auditLog.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorId: null,
      action: "account.admin_provisioned",
      targetType: "account",
      result: "applied",
    }));
  });

  it("uses Admin existence as the no-write idempotency marker", async () => {
    const database = {
      withTransaction: vi.fn(async <T>(work: (transaction: never) => Promise<T>): Promise<T> => work(tx)),
    } as unknown as Pick<Database, "withTransaction">;
    const accounts = {
      lockAccountTableForFirstAdmin: vi.fn().mockResolvedValue(undefined),
      countAdmins: vi.fn().mockResolvedValue(1),
      createAdmin: vi.fn(),
    };
    const auditLog = { record: vi.fn() };
    const service = createFirstAdminBootstrapService({ database, accountRepository: accounts, auditLog });

    await expect(service.bootstrap({
      email: "different-admin@example.com",
      password: "Synthetic-admin-password1!",
      requestId: "00000000-0000-4000-8000-000000000002" as RequestId,
    })).resolves.toEqual({ ok: true, status: "already_provisioned" });

    expect(accounts.createAdmin).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });
});
