import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import UserLayout from "../../../src/app/app/layout";
import { submitLogout } from "../../../src/components/auth-client";

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("normal-user logout behavior", () => {
  it("gets a CSRF token, logs out with same-origin credentials, and reports success", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return calls.length === 1 ? response({ csrfToken: "csrf_v1.synthetic" }) : response(undefined, 204);
    };

    await expect(submitLogout(fetcher)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.input).toBe("/api/v1/auth/csrf");
    expect(calls[0]?.init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
    expect(calls[1]?.input).toBe("/api/v1/auth/logout");
    expect(calls[1]?.init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(calls[1]?.init?.headers).toEqual({ "X-CSRF-Token": "csrf_v1.synthetic" });
  });

  it("reports a safe failure when logout cannot complete", async () => {
    const fetcher = async () => response({ error: { code: "internal_error" } }, 500);

    await expect(submitLogout(fetcher)).resolves.toEqual({
      ok: false,
      message: "We couldn’t sign you out right now. Please try again.",
    });
  });

  it("renders the normal-user shell with an account menu and no private session details", () => {
    const rendered = renderToStaticMarkup(createElement(UserLayout, null, createElement("p", null, "Content")));

    expect(rendered).toContain("Sign out");
    expect(rendered).toContain("Manage my account");
    expect(rendered).toContain('disabled="" type="button">Manage my account');
    expect(rendered).toContain("data-account-menu");
    expect(rendered).toContain("Your account");
    expect(rendered).not.toContain("session");
    expect(rendered).not.toContain("@example");
  });
});
