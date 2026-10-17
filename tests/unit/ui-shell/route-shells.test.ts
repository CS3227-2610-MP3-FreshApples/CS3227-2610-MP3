import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RootLayout from "../../../src/app/layout";
import UserLayout from "../../../src/app/app/layout";
import AdminLayout from "../../../src/app/admin/layout";

function markup(layout: (props: { children: React.ReactNode }) => React.ReactNode): string {
  return renderToStaticMarkup(layout({ children: createElement("p", null, "Shell content") }));
}

describe("S-07 route shells", () => {
  it("keeps the public, user, and admin URL prefixes in the D-49 route tree", () => {
    const routes = [
      "src/app/page.tsx",
      "src/app/(public)/movies/page.tsx",
      "src/app/(public)/movies/[id]/page.tsx",
      "src/app/(public)/announcements/page.tsx",
      "src/app/app/page.tsx",
      "src/app/app/reviews/page.tsx",
      "src/app/app/reports/page.tsx",
      "src/app/admin/page.tsx",
      "src/app/admin/movies/page.tsx",
      "src/app/admin/reviews/page.tsx",
      "src/app/admin/reports/page.tsx",
      "src/app/admin/announcements/page.tsx",
      "src/app/admin/users/page.tsx",
    ];

    for (const route of routes) {
      expect(existsSync(resolve(process.cwd(), route))).toBe(true);
    }
  });

  it("renders the root shell and the D-49 user and admin navigation boundaries", () => {
    const root = markup(RootLayout);
    const user = markup(UserLayout);
    const admin = markup(AdminLayout);

    expect(root).toContain("Shell content");
    expect(user).toContain('href="/app"');
    expect(user).toContain('href="/app/reviews"');
    expect(user).toContain('href="/app/reports"');
    expect(user).not.toContain("/admin");
    expect(admin).toContain('href="/admin"');
    expect(admin).toContain('href="/admin/movies"');
    expect(admin).toContain('href="/admin/reviews"');
    expect(admin).toContain('href="/admin/reports"');
    expect(admin).toContain('href="/admin/announcements"');
    expect(admin).toContain('href="/admin/users"');
  });

  it("keeps layouts as presentation shells without authorization dependencies", () => {
    for (const shell of [markup(RootLayout), markup(UserLayout), markup(AdminLayout)]) {
      expect(shell).not.toContain("forbidden");
      expect(shell).not.toContain("unauthenticated");
    }
  });
});
