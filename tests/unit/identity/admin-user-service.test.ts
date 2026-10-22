import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAdminUserService } from "../../../src/server/services/identity";
import type { AdminUserRepository } from "../../../src/server/repositories/identity";
import type { Database } from "../../../src/server/db";
import type { AccountId, SessionId, Tx } from "../../../src/server/shared";
import type { Principal } from "../../../src/server/services/identity";

const ADMIN: Principal = {
  accountId: "00000000-0000-4000-8000-000000000001" as AccountId,
  sessionId: "session" as SessionId,
  role: "ADMIN",
};
const USER: Principal = { ...ADMIN, role: "USER" };
const accountId = "00000000-0000-4000-8000-000000000002" as AccountId;
const tx = {} as Tx;

function database(): Pick<Database, "withTransaction" | "withTransactionResult"> {
  return {
    withTransaction: async <T>(work: (transaction: Tx) => Promise<T>) => work(tx),
    withTransactionResult: async <T, E>(work: (transaction: Tx) => Promise<{ ok: true; value: T } | { ok: false; error: E }>) => work(tx),
  };
}

describe("A-06 Admin user read service", () => {
  it("returns only the approved projection and passes filters and pagination to the repository", async () => {
    const users: AdminUserRepository = {
      count: vi.fn().mockResolvedValue(12),
      list: vi.fn().mockResolvedValue([{ id: accountId, displayName: "Alice", status: "active", version: 4 }]),
      findById: vi.fn(),
    };
    const service = createAdminUserService({ database: database(), users });

    const result = await service.list(ADMIN, { status: "active", q: "Ali" }, 2, 10);

    expect(result).toEqual({ ok: true, value: { items: [{ id: accountId, displayName: "Alice", status: "active", version: 4 }], total: 12 } });
    expect(users.count).toHaveBeenCalledWith(tx, { status: "active", q: "Ali" });
    expect(users.list).toHaveBeenCalledWith(tx, { status: "active", q: "Ali" }, 10, 10);
  });

  it("does not query for a non-Admin principal", async () => {
    const users: AdminUserRepository = { count: vi.fn(), list: vi.fn(), findById: vi.fn() };
    const service = createAdminUserService({ database: database(), users });

    await expect(service.list(USER, { status: null, q: null }, 1, 20)).resolves.toEqual({ ok: false, error: { kind: "forbidden" } });
    expect(users.count).not.toHaveBeenCalled();
  });
});
