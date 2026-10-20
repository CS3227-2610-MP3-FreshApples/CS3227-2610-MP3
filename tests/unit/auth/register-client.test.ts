import { describe, expect, it } from "vitest";

import { submitRegistration } from "../../../src/components/auth-client";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("public registration client behavior — increment 3", () => {
  it("rejects mismatched repeat passwords before requesting CSRF or sending credentials", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return response({ csrfToken: "csrf_v1.unexpected" });
    };

    await expect(submitRegistration({ displayName: "Person", email: "person@example.com", password: "Password1!", confirmPassword: "Password2!" }, fetcher)).resolves.toEqual({
      ok: false,
      kind: "validation",
      fieldErrors: { confirmPassword: ["Passwords do not match."] },
    });
    expect(calls).toBe(0);
  });

  it("prepares CSRF, submits only registration fields, and returns the created account without a session", async () => {
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
      }, 201);
    };

    await expect(submitRegistration({ displayName: "Person", email: "person@example.com", password: "Password1!", confirmPassword: "Password1!" }, fetcher)).resolves.toMatchObject({
      ok: true,
      account: { role: "USER", status: "active" },
    });

    expect(calls[1]?.input).toBe("/api/v1/auth/register");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      displayName: "Person",
      email: "person@example.com",
      password: "Password1!",
    });
  });

  it("maps duplicate email to safe conflict guidance", async () => {
    const fetcher = async (input: RequestInfo | URL) => input === "/api/v1/auth/csrf"
      ? response({ csrfToken: "csrf_v1.synthetic" })
      : response({ error: { code: "conflict", message: "The request conflicts with the current state." } }, 409);

    await expect(submitRegistration({ displayName: "Person", email: "person@example.com", password: "Password1!", confirmPassword: "Password1!" }, fetcher)).resolves.toEqual({
      ok: false,
      kind: "conflict",
      message: "An account may already exist for this email. Try signing in.",
    });
  });

  it("preserves server field errors for invalid registration input", async () => {
    const fetcher = async (input: RequestInfo | URL) => input === "/api/v1/auth/csrf"
      ? response({ csrfToken: "csrf_v1.synthetic" })
      : response({ error: { code: "validation_failed", message: "One or more fields are invalid.", fieldErrors: { password: ["must include a special character"] } } }, 422);

    await expect(submitRegistration({ displayName: "Person", email: "person@example.com", password: "Password1", confirmPassword: "Password1" }, fetcher)).resolves.toEqual({
      ok: false,
      kind: "validation",
      fieldErrors: { password: ["must include a special character"] },
    });
  });
});
