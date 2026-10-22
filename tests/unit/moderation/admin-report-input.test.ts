import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { parseAdminReportFilters } from "../../../src/server/services/moderation/admin-report-input";

describe("A-05 Admin Report filters", () => {
  it("defaults to open reports and accepts the all/status/category filters", () => {
    expect(parseAdminReportFilters(new URLSearchParams())).toEqual({ ok: true, value: { status: "open", category: null } });
    expect(parseAdminReportFilters(new URLSearchParams("status=all&category=harassment"))).toEqual({ ok: true, value: {
      status: "all",
      category: "harassment",
    }});
    expect(parseAdminReportFilters(new URLSearchParams("status=dismissed&category=spam"))).toEqual({ ok: true, value: {
      status: "dismissed",
      category: "spam",
    }});
  });

  it("rejects unknown status and category values", () => {
    const result = parseAdminReportFilters(new URLSearchParams("status=closed&category=abuse"));
    expect(result).toEqual({
      ok: false,
      error: {
        status: ["invalid status filter"],
        category: ["invalid category filter"],
      },
    });
  });
});
