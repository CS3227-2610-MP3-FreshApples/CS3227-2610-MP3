import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import AdminLayout from "../../../src/app/admin/layout";
import { logoutAdmin } from "../../../src/app/admin/_components/admin-account-control";

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("admin logout behavior", () => {
  it("redirects to sign-in after the authenticated logout succeeds", async () => {
    const replace = vi.fn();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return calls.length === 1
        ? response({ csrfToken: "csrf_v1.synthetic" })
        : response(undefined, 204);
    };

    await expect(logoutAdmin(fetcher, replace)).resolves.toEqual({ ok: true });
    expect(calls[1]?.input).toBe("/api/v1/auth/logout");
    expect(calls[1]?.init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(replace).toHaveBeenCalledWith("/sign-in");
  });

  it("keeps the admin dashboard in place and returns an inline-safe error on failure", async () => {
    const replace = vi.fn();
    const fetcher = async () => response({ error: { code: "internal_error" } }, 500);

    await expect(logoutAdmin(fetcher, replace)).resolves.toEqual({
      ok: false,
      message: "We couldn’t sign you out right now. Please try again.",
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("mounts the logout control in the admin shell", () => {
    const rendered = renderToStaticMarkup(createElement(AdminLayout, null, createElement("p", null, "Dashboard")));

    expect(rendered).toContain("Sign out");
    expect(rendered).toContain("Admin dashboard");
    expect(rendered).not.toContain("session");
  });
});
