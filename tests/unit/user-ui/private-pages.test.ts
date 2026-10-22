import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import UserOverviewPage from "../../../src/app/app/page";
import UserReviewsPage from "../../../src/app/app/reviews/page";
import UserReportsPage from "../../../src/app/app/reports/page";
import UserLayout from "../../../src/app/app/layout";

function html(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("private User pages", () => {
  it("renders a private overview with clear destinations and honest empty states", () => {
    const rendered = html(createElement(UserOverviewPage));

    expect(rendered).toContain("Your overview");
    expect(rendered).toContain("Your reviews");
    expect(rendered).toContain("Your reports");
    expect(rendered).toContain("No published reviews yet");
    expect(rendered).toContain("No submitted reports yet");
    expect(rendered).toContain("rounded-xl");
    expect(rendered).toContain('href="/movies">← Go back to movies</a>');
    expect(rendered).toContain('href="/app/reviews"');
    expect(rendered).toContain('aria-labelledby="user-reviews-card-title"');
    expect(rendered).toContain('href="/app/reports"');
    expect(rendered).toContain('aria-labelledby="user-reports-card-title"');
    expect(rendered).not.toContain("View your reviews");
    expect(rendered).not.toContain("View your reports");
  });

  it("renders private reviews and reports with safe available-state messaging", () => {
    const reviews = html(createElement(UserReviewsPage));
    const reports = html(createElement(UserReportsPage));

    expect(reviews).toContain("My reviews");
    expect(reviews).toContain("Loading reviews…");
    expect(reviews).toContain('aria-labelledby="user-reviews-title"');
    expect(reviews).toContain('aria-label="Review status"');
    expect(reviews).toContain('href="/app">← Go back to overview</a>');
    expect(reports).toContain("My reports");
    expect(reports).toContain("No submitted reports yet");
    expect(reports).toContain("private");
    expect(reports).toContain("border-slate-200");
    expect(reports).toContain('href="/app">← Go back to overview</a>');
  });

  it("keeps the private shell focused on User destinations", () => {
    const rendered = html(createElement(UserLayout, null, createElement("p", null, "Content")));

    expect(rendered).toContain("Your account");
    expect(rendered).toContain('href="/app/reviews"');
    expect(rendered).toContain('href="/app/reports"');
    expect(rendered).not.toContain('href="/sign-in"');
    expect(rendered).not.toContain('href="/admin"');
  });
});
