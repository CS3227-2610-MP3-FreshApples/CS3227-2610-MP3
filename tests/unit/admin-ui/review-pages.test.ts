import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewSource } from "../../../src/app/admin/reviews/_components/review-source";
import { ReviewState, visibilityMessage } from "../../../src/app/admin/reviews/_components/review-state";
import { ReviewList } from "../../../src/app/admin/reviews/_components/review-list";
import { ReviewDetail } from "../../../src/app/admin/reviews/_components/review-detail";
import { adminReviewView } from "../../support/admin-review-view";

describe("A-04 presentation", () => {
  it("escapes the source, names, assessment, quoted matches and limitations", () => {
    const attack = '<img src=x onerror="alert(1)">';
    const html = renderToStaticMarkup(createElement(ReviewSource, { review: {
      ...adminReviewView, body: attack, authorDisplayName: attack, contentRevision: 2,
      latestAssessment: { contentRevision: 1, capturedReviewVersion: 1, modelId: "fake", promptVersion: "p1", policyVersion: "v1",
        generatedAt: adminReviewView.createdAt, result: { assessment: "uncertain", explanation: attack, matches: [{ quote: attack, reason: attack }], limitations: [attack] } },
    } }));
    expect(html).not.toContain("<img");
    expect(html.match(/&lt;img/g)).toHaveLength(6);
    expect(html).toContain("Automatic assessment");
    expect(html).toContain("Limitations");
    expect(html).toContain("Historical assessment");
    expect(html).toContain("not the current text");
    expect(html).toContain("md:grid-cols-2");
  });
  it("shows independent status flags as text and never promises publication of held content", () => {
    const review = { ...adminReviewView, hidden: true, deleted: true, movieArchived: true };
    const html = renderToStaticMarkup(createElement(ReviewState, { review }));
    for (const label of ["Pending", "Hidden by Admin", "Deleted by author", "Movie archived"]) expect(html).toContain(label);
    expect(visibilityMessage(adminReviewView)).toMatch(/^Not public/);
    expect(visibilityMessage({ ...adminReviewView, moderationState: "flagged" })).toMatch(/^Not public/);
  });
  it("keeps an All reviews reset visible even before the list loads, with no AI generation control", () => {
    const html = renderToStaticMarkup(createElement(ReviewList, { page: 1, movieId: "", assessment: "all" }));
    expect(html).toContain('href="/admin/reviews"');
    expect(html).toContain("All reviews</a>");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading reviews…");
    const detail = renderToStaticMarkup(createElement(ReviewDetail, { reviewId: adminReviewView.id }));
    expect(detail).toContain("Loading review…");
    expect(`${html}${detail}`).not.toMatch(/>(check|retry|regenerate)[^<]*<\/button>/i);
  });
});
