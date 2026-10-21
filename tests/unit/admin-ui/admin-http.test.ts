import { describe, expect, it } from "vitest";

import {
  adminRead,
  adminWrite,
  failureFromResponse,
  formatUtc,
  noContentVersion,
  pageFromSearchParam,
  versionFromEtag,
  type Fetcher,
} from "../../../src/app/admin/_lib/admin-http";

// B#6 commit 3 (A-01/A-02 UI): the browser-side HTTP layer maps the api.md 8.1 error contract to safe
// messages, sends CSRF and If-Match on every mutation, and rejects responses it does not recognise.

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function apiError(status: number, code: string, fieldErrors?: unknown): Response {
  return json({ error: { code, message: "server text", requestId: "00000000-0000-4000-8000-000000000000", fieldErrors } }, status);
}

type Call = { input: RequestInfo | URL; init?: RequestInit };

function recording(...responses: Response[]): { calls: Call[]; fetcher: Fetcher } {
  const calls: Call[] = [];
  const queue = [...responses];
  return {
    calls,
    fetcher: async (input, init) => {
      calls.push({ input, init });
      const next = queue.shift();
      if (next === undefined) throw new Error("unexpected request");
      return next;
    },
  };
}

const isNamed = (value: unknown): value is { name: string } =>
  typeof value === "object" && value !== null && typeof (value as { name?: unknown }).name === "string";

describe("failureFromResponse", () => {
  it.each([
    [401, "unauthenticated", "unauthenticated"],
    [403, "forbidden", "forbidden"],
    [404, "not_found", "not_found"],
    [409, "stale_version", "stale"],
    [409, "conflict", "conflict"],
    [429, "rate_limited", "rate_limited"],
    [503, "service_unavailable", "unavailable"],
    [500, "internal_error", "unavailable"],
    [428, "precondition_required", "unavailable"],
  ] as const)("maps %i %s to %s with a client-owned message", async (status, code, kind) => {
    const failure = await failureFromResponse(apiError(status, code));
    expect(failure.kind).toBe(kind);
    expect(failure.message).not.toContain("server text");
  });

  it("maps a CSRF rejection to a reload instruction rather than a role message", async () => {
    const failure = await failureFromResponse(apiError(403, "csrf_failed"));
    expect(failure).toMatchObject({ kind: "forbidden" });
    expect(failure.message).toMatch(/reload/i);
  });

  it("keeps well-formed field errors from a 422 and drops malformed entries", async () => {
    const failure = await failureFromResponse(apiError(422, "validation_failed", {
      title: ["must be 1 to 200 characters"],
      genres: "not a list",
      cast: [1, 2],
    }));
    expect(failure).toEqual({
      ok: false,
      kind: "validation",
      message: expect.any(String),
      fieldErrors: { title: ["must be 1 to 200 characters"] },
    });
  });

  it("treats a non-JSON error body as unavailable, never as success", async () => {
    const failure = await failureFromResponse(new Response("<html>", { status: 502 }));
    expect(failure.kind).toBe("unavailable");
  });
});

describe("adminRead", () => {
  it("sends a no-store, same-origin GET and returns a body that matches the projection", async () => {
    const { calls, fetcher } = recording(json({ name: "ok" }));
    await expect(adminRead("/api/v1/admin/movies/x", isNamed, fetcher)).resolves.toEqual({ ok: true, value: { name: "ok" } });
    expect(calls[0]?.init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
    expect(calls[0]?.init?.method).toBeUndefined();
  });

  it("rejects a 200 body that does not match the projection", async () => {
    const { fetcher } = recording(json({ other: 1 }));
    await expect(adminRead("/x", isNamed, fetcher)).resolves.toMatchObject({ ok: false, kind: "unavailable" });
  });

  it("reports a network failure as unavailable", async () => {
    const fetcher: Fetcher = async () => {
      throw new TypeError("network");
    };
    await expect(adminRead("/x", isNamed, fetcher)).resolves.toMatchObject({ ok: false, kind: "unavailable" });
  });
});

describe("adminWrite", () => {
  it("fetches a CSRF token, then sends it with If-Match and a JSON body", async () => {
    const { calls, fetcher } = recording(json({ csrfToken: "csrf_v1.synthetic" }), json({ name: "saved" }));
    const result = await adminWrite(
      { path: "/api/v1/admin/movies/abc", method: "PATCH", body: { title: "T" }, version: 4 },
      async (response) => {
        const body: unknown = await response.json();
        return isNamed(body) ? body : null;
      },
      fetcher,
    );

    expect(result).toEqual({ ok: true, value: { name: "saved" } });
    expect(calls[0]?.input).toBe("/api/v1/auth/csrf");
    expect(calls[1]?.input).toBe("/api/v1/admin/movies/abc");
    expect(calls[1]?.init).toMatchObject({
      method: "PATCH",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": "csrf_v1.synthetic", "If-Match": "\"4\"", "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ title: "T" });
  });

  it("sends no body or Content-Type when the mutation has none", async () => {
    const { calls, fetcher } = recording(
      json({ csrfToken: "csrf_v1.synthetic" }),
      new Response(null, { status: 204, headers: { ETag: "\"5\"" } }),
    );
    await expect(adminWrite({ path: "/x", method: "DELETE", version: 4 }, noContentVersion, fetcher)).resolves.toEqual({ ok: true, value: 5 });
    expect(calls[1]?.init?.body).toBeUndefined();
    expect(calls[1]?.init?.headers).toEqual({ "X-CSRF-Token": "csrf_v1.synthetic", "If-Match": "\"4\"" });
  });

  it("sends no If-Match when no version is given", async () => {
    const { calls, fetcher } = recording(json({ csrfToken: "csrf_v1.synthetic" }), json({ name: "new" }, 201));
    await adminWrite({ path: "/x", method: "POST", body: {} }, async () => ({}), fetcher);
    expect(calls[1]?.init?.headers).not.toHaveProperty("If-Match");
  });

  it.each([
    ["a failed CSRF request", json({}, 503)],
    ["an empty CSRF token", json({ csrfToken: "" })],
    ["a missing CSRF token", json({ token: "x" })],
  ])("never sends the mutation after %s", async (_name, csrfResponse) => {
    const { calls, fetcher } = recording(csrfResponse);
    await expect(adminWrite({ path: "/x", method: "POST", body: {} }, async () => ({}), fetcher)).resolves.toMatchObject({
      ok: false,
      kind: "unavailable",
    });
    expect(calls).toHaveLength(1);
  });

  it("returns the mapped failure for a rejected mutation", async () => {
    const { fetcher } = recording(json({ csrfToken: "csrf_v1.synthetic" }), apiError(409, "stale_version"));
    await expect(adminWrite({ path: "/x", method: "PATCH", body: {}, version: 1 }, async () => ({}), fetcher)).resolves.toMatchObject({
      ok: false,
      kind: "stale",
    });
  });

  it("treats an unrecognised success body as unavailable", async () => {
    const { fetcher } = recording(json({ csrfToken: "csrf_v1.synthetic" }), json({ name: "x" }));
    await expect(adminWrite({ path: "/x", method: "POST", body: {} }, async () => null, fetcher)).resolves.toMatchObject({
      ok: false,
      kind: "unavailable",
    });
  });
});

describe("helpers", () => {
  it.each([
    ["\"7\"", 7],
    ["\"0\"", 0],
    ["W/\"7\"", null],
    ["7", null],
    ["\"x\"", null],
    [null, null],
  ])("versionFromEtag(%s) is %s", (etag, version) => {
    expect(versionFromEtag(etag)).toBe(version);
  });

  it("noContentVersion accepts only a 204 with a strong ETag", async () => {
    await expect(noContentVersion(new Response(null, { status: 204, headers: { ETag: "\"3\"" } }))).resolves.toBe(3);
    await expect(noContentVersion(new Response(null, { status: 204 }))).resolves.toBeNull();
    await expect(noContentVersion(new Response("{}", { status: 200, headers: { ETag: "\"3\"" } }))).resolves.toBeNull();
  });

  it.each([
    [undefined, 1],
    ["3", 3],
    [["4", "5"], 4],
    ["0", 1],
    ["-2", 1],
    ["2.5", 1],
    ["abc", 1],
    ["9999999999", 1],
  ] as const)("pageFromSearchParam(%j) is %i", (value, page) => {
    expect(pageFromSearchParam(value as string | string[] | undefined)).toBe(page);
  });

  it("formats ISO timestamps in UTC to the minute and leaves unparseable text unchanged", () => {
    expect(formatUtc("2026-10-20T08:15:42.123Z")).toBe("2026-10-20 08:15 UTC");
    expect(formatUtc("not a date")).toBe("not a date");
  });
});
