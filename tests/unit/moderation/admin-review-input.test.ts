import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseAdminReviewReason, parseAdminReviewFilters } from "../../../src/server/services/moderation/admin-review-input";

describe("A-04 input", () => {
  it("trims reasons and counts Unicode code points", () => {
    expect(parseAdminReviewReason({ reason: `  ${"😀".repeat(10)}  ` })).toEqual({ ok: true, value: { reason: "😀".repeat(10) } });
    expect(parseAdminReviewReason({ reason: "x".repeat(1000) }).ok).toBe(true);
    for (const input of [null, [], {}, { reason: 12 }, { reason: "x".repeat(9) }, { reason: "x".repeat(1001) }, { reason: "valid reason", hidden: false }]) {
      expect(parseAdminReviewReason(input).ok).toBe(false);
    }
  });
  it("defaults to all and validates filters", () => {
    expect(parseAdminReviewFilters(new URLSearchParams())).toEqual({ ok: true, value: { movieId: null, assessment: "all" } });
    expect(parseAdminReviewFilters(new URLSearchParams("assessment=needs-manual-review"))).toMatchObject({ ok: true, value: { assessment: "needs_manual_review" } });
    for (const query of ["assessment=unknown", "movieId=bad"]) expect(parseAdminReviewFilters(new URLSearchParams(query)).ok).toBe(false);
  });
});
