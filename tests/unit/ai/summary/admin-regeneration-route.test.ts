import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../src/server/composition", () => ({
  authGuards: { requireActiveAdminMutation: vi.fn() },
  adminSummaryRegenerationService: { regenerate: vi.fn() },
}));

import { adminSummaryRegenerationService, authGuards } from "../../../../src/server/composition";
import { POST, maxDuration } from "../../../../src/app/api/v1/admin/movies/[id]/summary/regenerate/route";
import type { AccountId, MovieId, SessionId } from "../../../../src/server/shared";

const MOVIE_ID = "20000000-0000-4000-8000-000000000051" as MovieId;
const principal = {
  accountId: "10000000-0000-4000-8000-000000000051" as AccountId,
  sessionId: "60000000-0000-4000-8000-000000000051" as SessionId,
  role: "ADMIN" as const,
};
const context = (id: string = MOVIE_ID) => ({ params: Promise.resolve({ id }) });
const request = (body = "{}", headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request(`https://app.example.test/api/v1/admin/movies/${MOVIE_ID}/summary/regenerate`, {
    method: "POST",
    headers,
    body,
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authGuards!.requireActiveAdminMutation).mockResolvedValue({ ok: true, value: principal });
  vi.mocked(adminSummaryRegenerationService!.regenerate).mockResolvedValue({
    ok: true,
    value: { status: "generated" },
  });
});

describe("POST Admin summary regeneration route", () => {
  it("uses the bounded AI duration", () => {
    expect(maxDuration).toBe(120);
  });

  it("guards the mutation and returns the safe outcome with matching generated request IDs", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.json()).toEqual({ status: "generated" });
    expect(authGuards!.requireActiveAdminMutation).toHaveBeenCalledOnce();
    expect(adminSummaryRegenerationService!.regenerate).toHaveBeenCalledWith(
      MOVIE_ID,
      principal,
      response.headers.get("x-request-id"),
    );
  });

  it.each([
    [{ kind: "unauthenticated" as const }, 401, "unauthenticated"],
    [{ kind: "forbidden" as const }, 403, "forbidden"],
    [{ kind: "csrf_failed" as const }, 403, "csrf_failed"],
  ])("returns the guard failure %# without reading or dispatching the body", async (error, status, code) => {
    vi.mocked(authGuards!.requireActiveAdminMutation).mockResolvedValue({ ok: false, error });
    const response = await POST(request("not-json", {}), context());
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(adminSummaryRegenerationService!.regenerate).not.toHaveBeenCalled();
  });

  it.each([
    ["not-a-uuid", "{}", { "content-type": "application/json" }, 404, "not_found"],
    [MOVIE_ID, "{", { "content-type": "application/json" }, 400, "malformed_request"],
    [MOVIE_ID, "{}", { "content-type": "text/plain" }, 415, "unsupported_media_type"],
    [MOVIE_ID, JSON.stringify({ force: true }), { "content-type": "application/json" }, 422, "validation_failed"],
  ])("rejects invalid transport input %#", async (id, body, headers, status, code) => {
    const response = await POST(request(body, headers), context(id));
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(adminSummaryRegenerationService!.regenerate).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "not_found" as const }, 404, "not_found", null],
    [{ kind: "rate_limited" as const, retryAfterSeconds: 212 }, 429, "rate_limited", "212"],
  ])("maps service rejection %# safely", async (error, status, code, retryAfter) => {
    vi.mocked(adminSummaryRegenerationService!.regenerate).mockResolvedValue({ ok: false, error });
    const response = await POST(request(), context());
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(response.headers.get("retry-after")).toBe(retryAfter);
  });

  it("returns pending after a committed generation fault without exposing provider details", async () => {
    vi.mocked(adminSummaryRegenerationService!.regenerate).mockResolvedValue({
      ok: true,
      value: { status: "pending" },
    });
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "pending" });
  });
});
