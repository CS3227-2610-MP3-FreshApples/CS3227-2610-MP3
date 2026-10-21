import { describe, expect, it } from "vitest";

import { listOwnReports, submitReport } from "../../../src/app/app/reports/_lib/report-client";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("My reports client", () => {
  it("loads a private report page without caching", async () => {
    let request: RequestInfo | URL | undefined;
    let options: RequestInit | undefined;
    const result = await listOwnReports(2, async (input, init) => {
      request = input;
      options = init;
      return response({ items: [], page: 2, pageSize: 20, total: 0 });
    });

    expect(result).toEqual({ ok: true, value: { items: [], page: 2, pageSize: 20, total: 0 } });
    expect(request).toBe("/api/v1/me/reports?page=2&pageSize=20");
    expect(options).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  });

  it("gets CSRF before submitting a report and returns the safe receipt", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const result = await submitReport({ reviewId: "review-1", category: "spam", explanation: "A valid report explanation." }, async (input, init) => {
      calls.push({ input, init });
      return calls.length === 1
        ? response({ csrfToken: "csrf.synthetic" })
        : response({ id: "00000000-0000-4000-8000-000000000001", reviewId: "00000000-0000-4000-8000-000000000002", category: "spam", status: "open", createdAt: "2026-10-21T00:00:00.000Z" }, 201);
    });

    expect(result).toMatchObject({ ok: true, value: { category: "spam" } });
    expect(calls[1]?.input).toBe("/api/v1/reports");
    expect(calls[1]?.init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(calls[1]?.init?.headers).toEqual(expect.objectContaining({ "X-CSRF-Token": "csrf.synthetic" }));
  });

  it("does not treat malformed receipts or duplicate errors as success", async () => {
    await expect(submitReport({ reviewId: "00000000-0000-4000-8000-000000000002", category: "spam", explanation: "A valid report explanation." }, async (input) => input === "/api/v1/auth/csrf" ? response({ csrfToken: "csrf.synthetic" }) : response({ id: "not-a-uuid" }, 201))).resolves.toEqual({ ok: false, message: "We could not complete that report request. Please try again." });
    await expect(submitReport({ reviewId: "00000000-0000-4000-8000-000000000002", category: "spam", explanation: "A valid report explanation." }, async (input) => input === "/api/v1/auth/csrf" ? response({ csrfToken: "csrf.synthetic" }) : response({ error: { code: "conflict" } }, 409))).resolves.toEqual({ ok: false, message: "This review has already been reported or is no longer available." });
    await expect(submitReport({ reviewId: "00000000-0000-4000-8000-000000000002", category: "spam", explanation: "A valid report explanation." }, async (input) => input === "/api/v1/auth/csrf" ? response({ csrfToken: "csrf.synthetic" }) : response({ error: { code: "validation_failed", fieldErrors: { explanation: ["too short"] } } }, 422))).resolves.toEqual({ ok: false, message: "Check the report category and explanation, then try again.", fieldErrors: { explanation: ["too short"] } });
  });
});
