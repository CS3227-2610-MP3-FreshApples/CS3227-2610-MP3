import type { FieldErrors, Result } from "../../shared";

export interface CatalogueQueryInput {
  readonly q?: unknown;
}

export interface CatalogueQuery {
  readonly q: string | null;
}

export type CatalogueQueryNormalizationResult = Result<CatalogueQuery, FieldErrors>;

export function normalizeCatalogueQuery(
  input: CatalogueQueryInput,
): CatalogueQueryNormalizationResult {
  if (typeof input.q !== "string") {
    return input.q === undefined
      ? { ok: true, value: { q: null } }
      : { ok: false, error: { q: ["invalid value"] } };
  }

  const q = input.q.trim();
  if (q.length === 0) {
    return { ok: true, value: { q: null } };
  }

  if (Array.from(q).length > 200) {
    return { ok: false, error: { q: ["must be at most 200 characters"] } };
  }

  return { ok: true, value: { q } };
}
