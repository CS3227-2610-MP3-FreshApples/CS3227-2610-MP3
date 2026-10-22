import { describe, expect, it } from "vitest";

import { isAdminUser, listUsers, updateUserStatus, validateUserReason } from "../../../src/app/admin/_lib/user-client";

const user = { id: "user-1", displayName: "Alice", status: "active" as const, version: 3 };

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("A-06 Admin user client", () => {
  it("validates the safe projection and sends approved list filters", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return response({ items: [user], page: 2, pageSize: 20, total: 1 });
    };

    await expect(listUsers(2, { status: "suspended", q: " Alice " }, fetcher)).resolves.toMatchObject({ ok: true });
    expect(String(calls[0]?.[0])).toContain("status=suspended");
    expect(String(calls[0]?.[0])).toContain("q=Alice");
    expect(isAdminUser(user)).toBe(true);
    expect(isAdminUser({ ...user, email: "secret@example.com" })).toBe(false);
  });

  it("sends CSRF, If-Match, and the status reason", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return String(input).endsWith("/csrf") ? response({ csrfToken: "csrf.synthetic" }) : response({ ...user, status: "suspended", version: 4 }, 200, { etag: '"4"' });
    };

    await expect(updateUserStatus(user.id, user.version, { status: "suspended", reason: "  Repeated abuse  " }, fetcher)).resolves.toMatchObject({ ok: true });
    expect(calls[1]?.[1]).toMatchObject({ method: "PATCH", headers: { "X-CSRF-Token": "csrf.synthetic", "If-Match": '"3"', "Content-Type": "application/json" } });
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({ status: "suspended", reason: "Repeated abuse" });
  });

  it("enforces the reason bounds", () => {
    expect(validateUserReason("short")).not.toBe("");
    expect(validateUserReason("A sufficiently detailed reason")).toBe("");
  });

  it("maps stale and malformed mutation responses to safe retryable failures", async () => {
    const staleFetcher = async (input: RequestInfo | URL) => String(input).endsWith("/csrf")
      ? response({ csrfToken: "csrf.synthetic" })
      : response({ error: { code: "stale_version" } }, 409);
    await expect(updateUserStatus(user.id, user.version, { status: "suspended", reason: "Repeated abuse" }, staleFetcher)).resolves.toEqual({
      ok: false,
      kind: "stale",
      message: "Someone changed this record after you loaded it. Nothing was saved. Load the latest version, then try again.",
    });

    const malformedFetcher = async () => response({ items: [{ id: user.id, displayName: user.displayName, status: user.status, version: "not-a-version" }] });
    await expect(listUsers(1, { status: "", q: "" }, malformedFetcher)).resolves.toMatchObject({ ok: false, kind: "unavailable" });
  });
});
