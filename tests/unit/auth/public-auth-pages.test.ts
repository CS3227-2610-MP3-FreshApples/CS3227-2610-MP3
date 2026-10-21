import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RegisterPage from "../../../src/app/(public)/register/page";
import SignInPage from "../../../src/app/(public)/sign-in/page";
import PublicLayout from "../../../src/app/(public)/layout";
import { publicNavigationForAccount } from "../../../src/components/navigation-data";

function html(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("public authentication UI — increment 1", () => {
  it("renders the sign-in page with the required fields and registration link", () => {
    const rendered = html(createElement(SignInPage));

    expect(rendered).toContain("Sign in");
    expect(rendered).toContain('type="email"');
    expect(rendered).toContain('autoComplete="email"');
    expect(rendered).toContain('autoComplete="current-password"');
    expect(rendered).toContain("border-slate-200");
    expect(rendered).toContain("min-h-11");
    expect(rendered).toContain('href="/register"');
  });

  it("renders registration guidance and a sign-in link without role controls", () => {
    const rendered = html(createElement(RegisterPage));

    expect(rendered).toContain("Create an account");
    expect(rendered).toContain('autoComplete="name"');
    expect(rendered).toContain("12–128 characters, including at least one number and one special character");
    expect(rendered).toContain('autoComplete="new-password"');
    expect(rendered).toContain('name="confirmPassword"');
    expect(rendered).toContain("border-slate-200");
    expect(rendered).toContain("min-h-11");
    expect(rendered).toContain('href="/sign-in"');
    expect(rendered).not.toContain('name="role"');
    expect(rendered).not.toContain('name="status"');
  });

  it("adds authentication links and a skip target to the public shell", () => {
    const rendered = html(createElement(PublicLayout, null, createElement("p", null, "Content")));

    expect(rendered).toContain('href="/sign-in"');
    expect(rendered).toContain('href="/register"');
    expect(rendered).toContain('href="#main-content"');
    expect(rendered).toContain('id="main-content"');
    expect(rendered.match(/<main/g)?.length).toBe(1);
  });

  it("keeps auth actions in a bordered, readable form surface", () => {
    const signIn = html(createElement(SignInPage));
    const register = html(createElement(RegisterPage));

    for (const rendered of [signIn, register]) {
      expect(rendered).toContain("rounded-xl");
      expect(rendered).toContain("bg-white");
      expect(rendered).toContain("focus-visible:ring-2");
    }
  });

  it("replaces public auth links with the signed-in display name", () => {
    const rendered = publicNavigationForAccount({ displayName: "Person", role: "USER" });

    expect(rendered).toEqual([
      { href: "/", label: "Home" },
      { href: "/movies", label: "Movies" },
      { href: "/announcements", label: "Announcements" },
      { href: "/app", label: "Person" },
    ]);
  });
});
