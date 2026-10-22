import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../src/server/composition", () => ({
  authGuards: { requireActiveAdminMutation: vi.fn() },
  adminUserService: { updateStatus: vi.fn() },
}));

import { PATCH } from "../../../src/app/api/v1/admin/users/[id]/status/route";
import { adminUserService, authGuards } from "../../../src/server/composition";
import type { Principal } from "../../../src/server/services/identity";
import type { AccountId, RowVersion, SessionId } from "../../../src/server/shared";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001" as AccountId;
const USER_ID = "00000000-0000-4000-8000-000000000002" as AccountId;
const principal: Principal = { accountId: ADMIN_ID, sessionId: "session" as SessionId, role: "ADMIN" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authGuards!.requireActiveAdminMutation).mockResolvedValue({ ok: true, value: principal });
});

describe("A-06 Admin user status route", () => {
  it("requires If-Match and returns the updated user with an ETag", async () => {
    vi.mocked(adminUserService!.updateStatus).mockResolvedValue({ ok: true, value: { id: USER_ID, displayName: "Alice", status: "suspended", version: 2 as RowVersion } });
    const request = new Request(`http://localhost:3000/api/v1/admin/users/${USER_ID}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": '"1"' },
      body: JSON.stringify({ status: "suspended", reason: "Repeated abuse" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: USER_ID }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"2"');
    expect(await response.json()).toEqual({ id: USER_ID, displayName: "Alice", status: "suspended", version: 2 });
    expect(adminUserService!.updateStatus).toHaveBeenCalledWith(principal, USER_ID, 1, { status: "suspended", reason: "Repeated abuse" }, expect.any(String));
  });

  it("rejects missing If-Match and does not call the service", async () => {
    const request = new Request(`http://localhost:3000/api/v1/admin/users/${USER_ID}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "suspended", reason: "Repeated abuse" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: USER_ID }) });

    expect(response.status).toBe(428);
    expect(adminUserService!.updateStatus).not.toHaveBeenCalled();
  });

  it("rejects invalid reason input before calling the service", async () => {
    const request = new Request(`http://localhost:3000/api/v1/admin/users/${USER_ID}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": '"1"' },
      body: JSON.stringify({ status: "suspended", reason: "short" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: USER_ID }) });

    expect(response.status).toBe(422);
    expect(adminUserService!.updateStatus).not.toHaveBeenCalled();
  });
});
