import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../src/server/composition", () => ({
  authGuards: { requireActiveAdmin: vi.fn() },
  adminUserService: { list: vi.fn(), get: vi.fn() },
}));

import { GET as listUsers } from "../../../src/app/api/v1/admin/users/route";
import { GET as getUser } from "../../../src/app/api/v1/admin/users/[id]/route";
import { adminUserService, authGuards } from "../../../src/server/composition";
import type { Principal } from "../../../src/server/services/identity";
import type { AccountId, RowVersion, SessionId } from "../../../src/server/shared";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001" as AccountId;
const USER_ID = "00000000-0000-4000-8000-000000000002" as AccountId;
const principal: Principal = { accountId: ADMIN_ID, sessionId: "session" as SessionId, role: "ADMIN" };

function request(path: string): Request {
  return new Request(`http://localhost:3000${path}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authGuards!.requireActiveAdmin).mockResolvedValue({ ok: true, value: principal });
});

describe("A-06 Admin user read routes", () => {
  it("returns filtered users with the safe list projection", async () => {
    vi.mocked(adminUserService!.list).mockResolvedValue({ ok: true, value: {
      items: [{ id: USER_ID, displayName: "Alice", status: "active", version: 4 as RowVersion }], total: 1,
    }});

    const response = await listUsers(request("/api/v1/admin/users?status=active&q=%20Alice%20&page=2&pageSize=10"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [{ id: USER_ID, displayName: "Alice", status: "active", version: 4 }], page: 2, pageSize: 10, total: 1 });
    expect(adminUserService!.list).toHaveBeenCalledWith(principal, { status: "active", q: "Alice" }, 2, 10);
  });

  it("returns a User detail with an ETag and does not expose private fields", async () => {
    vi.mocked(adminUserService!.get).mockResolvedValue({ ok: true, value: { id: USER_ID, displayName: "Alice", status: "suspended", version: 5 as RowVersion } });

    const response = await getUser(request(`/api/v1/admin/users/${USER_ID}`), { params: Promise.resolve({ id: USER_ID }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"5"');
    expect(await response.json()).toEqual({ id: USER_ID, displayName: "Alice", status: "suspended", version: 5 });
  });

  it("rejects an invalid filter before calling the service", async () => {
    const response = await listUsers(request(`/api/v1/admin/users?status=deleted&q=${"x".repeat(201)}`));

    expect(response.status).toBe(422);
    expect(adminUserService!.list).not.toHaveBeenCalled();
  });
});
