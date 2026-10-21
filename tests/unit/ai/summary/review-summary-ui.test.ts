import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../src/server/composition", () => ({
  publicSummaryReadService: { getSummary: vi.fn() },
}));

import {
  AI_SUMMARY_LABEL,
  ReviewSummarySection,
  ReviewSummaryView,
} from "../../../../src/app/(public)/movies/[id]/_components/review-summary";
import { publicSummaryReadService } from "../../../../src/server/composition";
import type { PublicSummaryView } from "../../../../src/server/services/ai/summary";
import type { MovieId } from "../../../../src/server/shared";

// FR-08 summary UI (AI-01, D-90, D-98 UI strings).

const MOVIE_ID = "20000000-0000-4000-8000-000000000041" as MovieId;
const read = vi.mocked(publicSummaryReadService as NonNullable<typeof publicSummaryReadService>);

const READY: PublicSummaryView = {
  status: "ready",
  eligibleCount: 12,
  summary: {
    overall: "Reviewers mostly praise the pacing.",
    strengths: [{ text: "The lead performance is praised." }],
    criticisms: [],
    mixedOpinions: [{ text: "Opinions on the ending are split." }],
    includedCount: 9,
    truncated: false,
    generatedAt: "2026-10-20T00:00:05.000Z",
  },
};

function html(state: Parameters<typeof ReviewSummaryView>[0]["state"]): string {
  return renderToStaticMarkup(createElement(ReviewSummaryView, { state }));
}

/** Renders the self-fetching section to completion, as the server does. */
async function section(): Promise<string> {
  const { prelude } = await prerender(createElement(ReviewSummarySection, { movieId: MOVIE_ID }));
  let text = "";
  const decoder = new TextDecoder();
  for await (const chunk of prelude as unknown as AsyncIterable<Uint8Array>) {
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("review summary states", () => {
  it("shows the fixed label, overall text, lists, counts and generation time when ready", () => {
    const rendered = html(READY);

    expect(AI_SUMMARY_LABEL).toBe("AI summary of a sample; may miss opinions or make mistakes");
    expect(rendered).toContain('<h2 class="text-xl font-semibold text-slate-950" id="review-summary-heading">Review summary</h2>');
    expect(rendered).toContain(`<p class="text-sm text-slate-600">${AI_SUMMARY_LABEL}</p>`);
    expect(rendered).toContain('<p class="text-lg leading-8 text-slate-700">Reviewers mostly praise the pacing.</p>');
    expect(rendered).toContain('<h3 class="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">Strengths</h3><ul><li>The lead performance is praised.</li></ul>');
    expect(rendered).toContain('<h3 class="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">Criticisms</h3><p>None noted.</p>');
    expect(rendered).toContain('<h3 class="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">Mixed opinions</h3><ul><li>Opinions on the ending are split.</li></ul>');
    expect(rendered).toContain('<p class="text-sm text-slate-600">Based on 9 of 12 eligible reviews.</p>');
    expect(rendered).toContain('<p class="text-sm text-slate-600">Generated <time dateTime="2026-10-20T00:00:05.000Z">2026-10-20 00:00 UTC</time></p>');
    expect(rendered).not.toContain("shortened");
  });

  it("shows the truncation notice only when an included Review was truncated", () => {
    const rendered = html({ ...READY, summary: { ...READY.summary, truncated: true } });
    expect(rendered).toContain("<p>Some reviews were shortened to their first 1,000 characters before summarizing.</p>");
  });

  it.each<[PublicSummaryView | { status: "unavailable" }, string]>([
    [{ status: "stale", eligibleCount: 5 }, "A review summary is awaiting its scheduled update."],
    [{ status: "missing", eligibleCount: 5 }, "A review summary is awaiting its scheduled update."],
    [{ status: "insufficient_reviews", eligibleCount: 2 }, "Not enough reviews for a summary yet (at least 3 are needed)."],
    [{ status: "unavailable" }, "The review summary is temporarily unavailable."],
  ])("shows one status line for %o", (state, line) => {
    const rendered = html(state);
    expect(rendered).toContain(`<p role="status">${line}</p>`);
    expect(rendered).not.toContain(AI_SUMMARY_LABEL);
    expect(rendered).not.toContain("<li>");
  });

  it("renders stored text as escaped plain text (AI-04)", () => {
    const rendered = html({
      ...READY,
      summary: { ...READY.summary, overall: "<script>alert(1)</script>", strengths: [{ text: '<img src=x onerror="1">' }] },
    });
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain("<img");
    expect(rendered).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("has no generate or retry control in any state (AT-07)", () => {
    for (const state of [READY, { status: "stale", eligibleCount: 5 }, { status: "unavailable" }] as const) {
      const rendered = html(state);
      for (const control of ["<button", "<form", "<a ", "<input"]) {
        expect(rendered).not.toContain(control);
      }
    }
  });
});

describe("self-fetching review summary section (D-98 MD-4)", () => {
  it("reads the summary for its Movie and renders it", async () => {
    read.getSummary.mockResolvedValue(READY);
    const rendered = await section();
    expect(read.getSummary).toHaveBeenCalledWith(MOVIE_ID);
    expect(rendered).toContain(AI_SUMMARY_LABEL);
  });

  it("renders nothing when the Movie was archived after the page read it", async () => {
    read.getSummary.mockResolvedValue(null);
    const rendered = await section();
    expect(rendered).not.toContain("Review summary");
    expect(rendered).not.toContain("<p");
  });

  it("renders the unavailable line instead of throwing when the read fails", async () => {
    read.getSummary.mockRejectedValue(new Error("connection refused"));
    const rendered = await section();
    expect(rendered).toContain("The review summary is temporarily unavailable.");
    expect(rendered).not.toContain("connection refused");
  });
});
