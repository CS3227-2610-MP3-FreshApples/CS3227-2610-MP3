import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublicReviewCard, ReportDialog } from "../../../src/app/(public)/movies/[id]/_components/public-review-list";

describe("public review cards", () => {
  it("renders escaped review text and a report action only for another signed-in User", () => {
    const rendered = renderToStaticMarkup(createElement(PublicReviewCard, {
      accountId: "account-2",
      review: {
        id: "00000000-0000-4000-8000-000000000003",
        movieId: "00000000-0000-4000-8000-000000000004",
        author: { id: "00000000-0000-4000-8000-000000000005", displayName: "Reviewer" },
        rating: 8,
        body: "A <script> tag\nwith a second line.",
        createdAt: "2026-10-21T00:00:00.000Z",
        updatedAt: "2026-10-21T01:00:00.000Z",
      },
      onReport: () => undefined,
    }));

    expect(rendered).toContain("A &lt;script&gt; tag");
    expect(rendered).toContain("with a second line");
    expect(rendered).toContain("Edited");
    expect(rendered).toContain("Report user");
  });

  it("associates the report form fields with accessible instructions", () => {
    const rendered = renderToStaticMarkup(createElement(ReportDialog, {
      review: {
        id: "00000000-0000-4000-8000-000000000003",
        movieId: "00000000-0000-4000-8000-000000000004",
        author: { id: "00000000-0000-4000-8000-000000000005", displayName: "Reviewer" },
        rating: 8,
        body: "A sufficiently long review body.",
        createdAt: "2026-10-21T00:00:00.000Z",
        updatedAt: "2026-10-21T00:00:00.000Z",
      },
      onCancel: () => undefined,
      onSubmitted: () => undefined,
    }));

    expect(rendered).toContain('role="dialog"');
    expect(rendered).toContain('aria-describedby="report-dialog-description"');
    expect(rendered).toContain('for="report-explanation"');
    expect(rendered).toContain('aria-describedby="report-explanation-hint"');
    expect(rendered).toContain('minLength="10"');
    expect(rendered).toContain("Submit report");
  });
});
