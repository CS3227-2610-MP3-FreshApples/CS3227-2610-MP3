import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAdminReportDecisionInput } from "../../../src/server/services/moderation/admin-report-decision-input";

describe("A-05 Admin report decision input", () => {
  it("accepts trimmed reasons and the two approved action shapes", () => {
    expect(parseAdminReportDecisionInput({ disposition: "accepted", actions: ["hide_review"], reason: "  A valid decision reason.  " })).toEqual({ ok: true, value: { disposition: "accepted", actions: ["hide_review"], reason: "A valid decision reason." } });
    expect(parseAdminReportDecisionInput({ disposition: "dismissed", actions: [], reason: "A valid dismissal reason." })).toEqual({ ok: true, value: { disposition: "dismissed", actions: [], reason: "A valid dismissal reason." } });
  });

  it("rejects unknown fields, invalid action/disposition combinations, and reasons outside the Unicode length bounds", () => {
    expect(parseAdminReportDecisionInput({ disposition: "dismissed", actions: ["hide_review"], reason: "A valid dismissal reason." })).toEqual({ ok: false, error: expect.objectContaining({ actions: expect.any(Array) }) });
    expect(parseAdminReportDecisionInput({ disposition: "accepted", actions: ["unknown"], reason: "A valid decision reason." })).toEqual({ ok: false, error: expect.objectContaining({ actions: expect.any(Array) }) });
    expect(parseAdminReportDecisionInput({ disposition: "accepted", actions: [], reason: "short" })).toEqual({ ok: false, error: expect.objectContaining({ reason: expect.any(Array) }) });
    expect(parseAdminReportDecisionInput({ disposition: "accepted", actions: [], reason: "😀".repeat(1001) })).toEqual({ ok: false, error: expect.objectContaining({ reason: expect.any(Array) }) });
    expect(parseAdminReportDecisionInput({ disposition: "accepted", actions: [], reason: "A valid decision reason.", extra: true })).toEqual({ ok: false, error: expect.objectContaining({ extra: expect.any(Array) }) });
  });
});
