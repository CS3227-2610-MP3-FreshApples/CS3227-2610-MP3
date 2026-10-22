import { describe, expect, it } from "vitest";

import { resolveAuthDestination, submitLogin } from "../../../src/components/auth-client";

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("public sign-in client behavior — increment 2", () => {
  it("prepares CSRF, submits credentials with the token, and returns the server account projection", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (calls.length === 1) return response({ csrfToken: "csrf_v1.synthetic" });
      return response({
        id: "00000000-0000-4000-8000-000000000001",
        displayName: "Person",
        role: "USER",
        status: "active",
        version: 1,
      });
    };

    await expect(submitLogin({ email: "person@example.com", password: "Password1!" }, fetcher)).resolves.toMatchObject({
      ok: true,
      account: { role: "USER", status: "active" },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.input).toBe("/api/v1/auth/csrf");
    expect(calls[0]?.init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
    expect(calls[1]?.input).toBe("/api/v1/auth/login");
    expect(calls[1]?.init).toMatchObject({ credentials: "same-origin" });
    expect(calls[1]?.init?.headers).toEqual(expect.objectContaining({
      "Content-Type": "application/json",
      "X-CSRF-Token": "csrf_v1.synthetic",
    }));
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ email: "person@example.com", password: "Password1!" });
  });

  it("maps safe authentication failures without exposing account state", async () => {
    const fetcher = async (input: RequestInfo | URL) => input === "/api/v1/auth/csrf"
      ? response({ csrfToken: "csrf_v1.synthetic" })
      : response({ error: { code: "unauthenticated", message: "Authentication is required." } }, 401);

    await expect(submitLogin({ email: "person@example.com", password: "Password1!" }, fetcher)).resolves.toEqual({
      ok: false,
      kind: "unauthenticated",
      message: "We couldn’t sign you in. Check your email and password.",
    });
  });

  it("routes only active server-authoritative roles", () => {
    expect(resolveAuthDestination({ role: "USER", status: "active" })).toBe("/movies");
    expect(resolveAuthDestination({ role: "ADMIN", status: "active" })).toBe("/admin");
    expect(resolveAuthDestination({ role: "USER", status: "suspended" })).toBeNull();
  });
});
