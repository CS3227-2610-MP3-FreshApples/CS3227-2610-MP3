import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAdminUserFilters } from "../../../src/server/services/identity";

describe("A-06 Admin user filters", () => {
  it("defaults to both statuses and normalizes the approved search semantics", () => {
    expect(parseAdminUserFilters(new URLSearchParams())).toEqual({
      ok: true,
      value: { status: null, q: null },
    });
    expect(parseAdminUserFilters(new URLSearchParams("status=suspended&q=%20Alice%20"))).toEqual({
      ok: true,
      value: { status: "suspended", q: "Alice" },
    });
    expect(parseAdminUserFilters(new URLSearchParams("q=%20%20"))).toEqual({
      ok: true,
      value: { status: null, q: null },
    });
  });

  it("rejects invalid status and overlong search values", () => {
    const result = parseAdminUserFilters(new URLSearchParams(`status=deleted&q=${"x".repeat(201)}`));
    expect(result).toEqual({
      ok: false,
      error: {
        status: ["invalid status filter"],
        q: ["must be at most 200 characters"],
      },
    });
  });
});
