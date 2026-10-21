import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { parseSummaryOutput } from "../../../../src/server/services/ai/summary";

// Independent Q-1 cases for the D-87 parser on untrusted provider content (AI-04).

const LABELS = ["R1", "R2", "R3"];
const INVALID = { ok: false, error: { kind: "invalid_output" } };
const LISTS = '"strengths":[],"criticisms":[],"mixedOpinions":[]';

describe("summary output with duplicate JSON keys (D-87, AI-04)", () => {
  it("validates the value JSON.parse keeps, so an earlier unsafe duplicate is never stored", () => {
    const content = `{"overall":"<script>alert(1)</script>","overall":"Fine.",${LISTS}}`;

    const result = parseSummaryOutput(content, LABELS);

    expect(result).toEqual({ ok: true, value: { overall: "Fine.", strengths: [], criticisms: [], mixedOpinions: [] } });
    expect(JSON.stringify(result)).not.toContain("script");
  });

  it("rejects output whose last duplicate is unsafe", () => {
    expect(parseSummaryOutput(`{"overall":"Fine.","overall":"See www.example.test",${LISTS}}`, LABELS)).toEqual(INVALID);
  });

  it("checks the sources of the item list JSON.parse keeps", () => {
    const content =
      `{"overall":"Fine.","strengths":[{"text":"Good.","sources":["R1"]}],` +
      `"strengths":[{"text":"Good.","sources":["R9"]}],"criticisms":[],"mixedOpinions":[]}`;

    expect(parseSummaryOutput(content, LABELS)).toEqual(INVALID);
  });
});

function withOverallEscaped(escapedOverall: string): string {
  return `{"overall":"${escapedOverall}",${LISTS}}`;
}

describe("summary output with unpaired surrogates (D-96 F1)", () => {
  it.each([
    ["a lone high surrogate", "Fine \\ud800 film."],
    ["a lone low surrogate", "Fine \\udc00 film."],
    ["a reversed pair", "Fine \\udc00\\ud800 film."],
    ["a trailing high surrogate", "Fine film.\\ud83c"],
  ])("rejects %s, which jsonb cannot store", (_label, overall) => {
    expect(parseSummaryOutput(withOverallEscaped(overall), LABELS)).toEqual(INVALID);
  });

  it("rejects an unpaired surrogate in item text", () => {
    const content = `{"overall":"Fine.","strengths":[{"text":"Good \\ud800.","sources":["R1"]}],"criticisms":[],"mixedOpinions":[]}`;

    expect(parseSummaryOutput(content, LABELS)).toEqual(INVALID);
  });

  it("accepts a valid surrogate pair, escaped or literal", () => {
    expect(parseSummaryOutput(withOverallEscaped("Loved it \\ud83c\\udfac."), LABELS)).toMatchObject({
      ok: true,
      value: { overall: "Loved it \u{1F3AC}." },
    });
    expect(parseSummaryOutput(withOverallEscaped("Loved it \u{1F3AC}."), LABELS)).toMatchObject({ ok: true });
  });
});

describe("summary markup check uses ASCII letters (D-96 F2)", () => {
  it.each([
    ["an accented letter", "Rated <é> by some."],
    ["a Cyrillic letter", "Rated <ж by some."],
    ["a CJK character", "評価 <良 です。"],
  ])("accepts < before %s, which HTML does not start a tag with", (_label, text) => {
    expect(parseSummaryOutput(withOverallEscaped(text), LABELS)).toMatchObject({ ok: true, value: { overall: text } });
  });

  it.each(["<a", "<Z", "</", "<!", "<?"])("rejects %s", (markup) => {
    expect(parseSummaryOutput(withOverallEscaped(`Praised ${markup} here.`), LABELS)).toEqual(INVALID);
  });
});

describe("summary output parsing never throws on hostile structure (D-87)", () => {
  it.each([
    ["a deeply nested array", "[".repeat(100_000) + "]".repeat(100_000)],
    ["a deeply nested overall", `{"overall":${"[".repeat(50_000)}${"]".repeat(50_000)},${LISTS}}`],
    ["a deeply nested source", `{"overall":"Fine.","strengths":[{"text":"Good.","sources":${"[".repeat(50_000)}${"]".repeat(50_000)}}],"criticisms":[],"mixedOpinions":[]}`],
    ["a long sources list", `{"overall":"Fine.","strengths":[{"text":"Good.","sources":${JSON.stringify(Array.from({ length: 100_000 }, (_, i) => `R${i}`))}}],"criticisms":[],"mixedOpinions":[]}`],
  ])("rejects %s", (_label, content) => {
    expect(() => parseSummaryOutput(content, LABELS)).not.toThrow();
    expect(parseSummaryOutput(content, LABELS)).toEqual(INVALID);
  });
});
