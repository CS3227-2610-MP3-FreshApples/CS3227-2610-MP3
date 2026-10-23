import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/admin" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

import { AdminDashboardBackLink } from "../../../src/app/admin/_components/admin-dashboard-back-link";
import AdminOverviewPage from "../../../src/app/admin/page";
import { publicNavigationForAccount } from "../../../src/components/navigation-data";

describe("Admin dashboard navigation", () => {
  it("labels the Admin destination independently of the account display name", () => {
    const links = publicNavigationForAccount({ displayName: "Catalogue operator", role: "ADMIN" });
    expect(links.slice(-2)).toEqual([
      { href: "/announcements", label: "Announcements" },
      { href: "/admin", label: "Admin Dashboard" },
    ]);
    expect(publicNavigationForAccount({ displayName: "Member", role: "USER" })).toEqual([
      { href: "/", label: "Home" },
      { href: "/movies", label: "Movies" },
      { href: "/announcements", label: "Announcements" },
    ]);
  });

  it("offers all five management destinations", () => {
    const html = renderToStaticMarkup(createElement(AdminOverviewPage));
    for (const area of ["movies", "announcements", "reviews", "reports", "users"]) {
      expect(html).toContain(`href="/admin/${area}"`);
    }
    expect(html).toContain("Manage reports");
    expect(html).toContain("Manage users");
  });

  it.each([
    "/admin/movies", "/admin/movies/new", "/admin/movies/movie-id",
    "/admin/announcements", "/admin/announcements/new", "/admin/announcements/announcement-id",
    "/admin/reviews", "/admin/reviews/review-id", "/admin/reports", "/admin/reports/report-id", "/admin/users",
  ])("offers a dashboard return from %s", (pathname) => {
    route.pathname = pathname;
    const html = renderToStaticMarkup(createElement(AdminDashboardBackLink));
    expect(html).toContain('href="/admin"');
    expect(html).toContain("Back to admin dashboard");
  });

  it.each(["/admin", "/movies", null])("omits a redundant return link on %s", (pathname) => {
    route.pathname = pathname;
    expect(renderToStaticMarkup(createElement(AdminDashboardBackLink))).toBe("");
  });
});
