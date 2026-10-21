import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../src/server/composition", () => ({
  publicSummaryReadService: { getSummary: vi.fn() },
}));

import { ReviewSummaryView } from "../../../../src/app/(public)/movies/[id]/_components/review-summary";

describe("review summary presentation", () => {
  it("uses the public movie-page card hierarchy for a ready summary", () => {
    const rendered = renderToStaticMarkup(createElement(ReviewSummaryView, {
      state: {
        status: "ready",
        eligibleCount: 3,
        summary: {
          overall: "A balanced response.",
          strengths: [],
          criticisms: [],
          mixedOpinions: [],
          includedCount: 3,
          truncated: false,
          generatedAt: "2026-10-20T00:00:05.000Z",
        },
      },
    }));

    expect(rendered).toContain("space-y-4 rounded-xl border border-slate-200 bg-white p-6 sm:p-8");
    expect(rendered).toContain("text-xl font-semibold text-slate-950");
    expect(rendered).toContain("text-sm text-slate-600");
  });
});
