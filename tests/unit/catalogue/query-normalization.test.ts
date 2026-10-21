import { describe, expect, expectTypeOf, it } from "vitest";

import {
  normalizeCatalogueQuery,
  type CatalogueQueryNormalizationResult,
} from "../../../src/server/services/catalogue/query-normalization";

describe("catalogue q normalization", () => {
  it("trims q and treats omitted, empty, and whitespace-only values as no filter", () => {
    expect(normalizeCatalogueQuery({})).toEqual({ ok: true, value: { q: null } });
    expect(normalizeCatalogueQuery({ q: "" })).toEqual({ ok: true, value: { q: null } });
    expect(normalizeCatalogueQuery({ q: " \t\n " })).toEqual({ ok: true, value: { q: null } });
    expect(normalizeCatalogueQuery({ q: "  Spirited Away  " })).toEqual({
      ok: true,
      value: { q: "Spirited Away" },
    });
  });

  it("counts Unicode code points and rejects non-empty q over 200 code points", () => {
    expect(normalizeCatalogueQuery({ q: `  ${"😀".repeat(200)}  ` })).toEqual({
      ok: true,
      value: { q: "😀".repeat(200) },
    });
    expect(normalizeCatalogueQuery({ q: "😀".repeat(201) })).toEqual({
      ok: false,
      error: { q: ["must be at most 200 characters"] },
    });
  });

  it("returns a typed validation result for an invalid q value", () => {
    expectTypeOf(normalizeCatalogueQuery).returns.toEqualTypeOf<CatalogueQueryNormalizationResult>();
    expect(normalizeCatalogueQuery({ q: 42 })).toEqual({
      ok: false,
      error: { q: ["invalid value"] },
    });
  });
});
