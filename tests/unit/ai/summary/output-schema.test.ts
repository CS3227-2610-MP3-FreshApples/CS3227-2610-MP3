import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import {
  parseSummaryOutput,
  validateSummaryOutput,
  type SummaryOutput,
} from "../../../../src/server/services/ai/summary";

const LABELS = ["R1", "R2", "R3", "R4"];
const INVALID = { ok: false, error: { kind: "invalid_output" } };

/** The D-87 example shape. */
function valid(): Record<string, unknown> {
  return {
    overall: "Reviewers mostly praise the pacing and the lead performance.",
    strengths: [{ text: "The lead performance is widely praised.", sources: ["R1", "R3"] }],
    criticisms: [],
    mixedOpinions: [{ text: "Opinions on the ending are split.", sources: ["R2", "R4"] }],
  };
}

function item(text = "A point.", sources: unknown = ["R1"]): Record<string, unknown> {
  return { text, sources };
}

function withOverall(overall: unknown): Record<string, unknown> {
  return { ...valid(), overall };
}

function withStrengths(strengths: unknown): Record<string, unknown> {
  return { ...valid(), strengths };
}

function parse(value: unknown, labels: readonly string[] = LABELS) {
  return parseSummaryOutput(JSON.stringify(value), labels);
}

describe("summary output parsing (D-87, O-27)", () => {
  it("accepts the D-87 example and returns it unchanged", () => {
    expect(parse(valid())).toEqual({ ok: true, value: valid() });
  });

  it("accepts every list empty", () => {
    const output = { overall: "Nothing stood out.", strengths: [], criticisms: [], mixedOpinions: [] };

    expect(parse(output)).toEqual({ ok: true, value: output });
  });

  it.each([
    ["surrounding whitespace", (json: string) => `\n  ${json}\t\n`],
    ["an untagged fence", (json: string) => "```\n" + json + "\n```"],
    ["a json fence", (json: string) => "```json\n" + json + "\n```"],
    ["a fence with surrounding whitespace", (json: string) => "  ```json\n" + json + "\n```  \n"],
  ])("accepts content with %s", (_label, wrap) => {
    expect(parseSummaryOutput(wrap(JSON.stringify(valid())), LABELS)).toEqual({ ok: true, value: valid() });
  });

  it.each([
    ["empty content", ""],
    ["prose", "Here is the summary you asked for."],
    ["truncated JSON", JSON.stringify(valid()).slice(0, -1)],
    ["JSON followed by prose", `${JSON.stringify(valid())} Hope this helps!`],
    ["prose before a fence", "Summary:\n```json\n" + JSON.stringify(valid()) + "\n```"],
    ["two nested fences", "```\n```json\n" + JSON.stringify(valid()) + "\n```\n```"],
    ["a fence with another tag", "```javascript\n" + JSON.stringify(valid()) + "\n```"],
    ["an upper-case fence tag", "```JSON\n" + JSON.stringify(valid()) + "\n```"],
    ["an unclosed fence", "```json\n" + JSON.stringify(valid())],
    ["an empty fence", "``````"],
    ["a bare fence", "```"],
    ["an array", JSON.stringify([valid()])],
    ["null", "null"],
    ["a string", JSON.stringify(JSON.stringify(valid()))],
    ["a number", "42"],
  ])("rejects %s", (_label, content) => {
    expect(parseSummaryOutput(content, LABELS)).toEqual(INVALID);
  });
});

describe("summary output strict fields (D-87)", () => {
  it.each(["overall", "strengths", "criticisms", "mixedOpinions"])("rejects output missing %s", (key) => {
    const output = valid();
    delete output[key];

    expect(parse(output)).toEqual(INVALID);
  });

  it.each([
    ["an unknown top-level key", { ...valid(), confidence: 0.9 }],
    ["a renamed key", { ...withOverall(undefined), summary: "Text." }],
    ["a snake_case key", { ...valid(), mixedOpinions: undefined, mixed_opinions: [] }],
    ["an unknown item key", withStrengths([{ ...item(), weight: 1 }])],
    ["an item missing text", withStrengths([{ sources: ["R1"] }])],
    ["an item missing sources", withStrengths([{ text: "A point." }])],
  ])("rejects %s", (_label, output) => {
    expect(parse(output)).toEqual(INVALID);
  });

  it("rejects an own __proto__ key from JSON.parse instead of ignoring it", () => {
    const content = JSON.stringify(valid()).replace(/^\{/, '{"__proto__":{"polluted":true},');

    expect(parseSummaryOutput(content, LABELS)).toEqual(INVALID);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    ["overall as a number", withOverall(42)],
    ["overall as null", withOverall(null)],
    ["overall as a list", withOverall(["Text."])],
    ["a list as an object", withStrengths({ 0: item() })],
    ["a list as null", withStrengths(null)],
    ["an item as a string", withStrengths(["A point."])],
    ["text as a number", withStrengths([item(7 as unknown as string)])],
    ["sources as a string", withStrengths([item("A point.", "R1")])],
    ["a source as a number", withStrengths([item("A point.", [1])])],
    ["a source as null", withStrengths([item("A point.", [null])])],
  ])("rejects %s", (_label, output) => {
    expect(parse(output)).toEqual(INVALID);
  });
});

describe("summary output bounds (AI-01 item 6, D-87)", () => {
  it("accepts overall at exactly 800 code points, counting each astral character once", () => {
    const overall = "😀".repeat(800);
    expect(overall.length).toBe(1_600);

    expect(parse(withOverall(overall))).toMatchObject({ ok: true, value: { overall } });
  });

  it("rejects overall at 801 code points", () => {
    expect(parse(withOverall("a".repeat(801)))).toEqual(INVALID);
    expect(parse(withOverall("😀".repeat(801)))).toEqual(INVALID);
  });

  it("measures after trimming and stores the trimmed text", () => {
    const result = parse(withOverall(`   ${"a".repeat(800)}   `));

    expect(result).toMatchObject({ ok: true, value: { overall: "a".repeat(800) } });
  });

  it.each([
    ["empty", ""],
    ["only spaces", "    "],
    ["only line feeds", "\n\n"],
  ])("rejects overall that is %s", (_label, overall) => {
    expect(parse(withOverall(overall))).toEqual(INVALID);
  });

  it("accepts item text at exactly 240 code points and rejects 241", () => {
    expect(parse(withStrengths([item("é".repeat(240))]))).toMatchObject({ ok: true });
    expect(parse(withStrengths([item("é".repeat(241))]))).toEqual(INVALID);
  });

  it("trims item text and rejects item text that is empty after trimming", () => {
    expect(parse(withStrengths([item("  Praised.  ")]))).toMatchObject({
      ok: true,
      value: { strengths: [{ text: "Praised.", sources: ["R1"] }] },
    });
    expect(parse(withStrengths([item("   ")]))).toEqual(INVALID);
  });

  it.each(["strengths", "criticisms", "mixedOpinions"])("accepts 3 %s and rejects 4", (key) => {
    const three = [item("One."), item("Two."), item("Three.")];

    expect(parse({ ...valid(), [key]: three })).toMatchObject({ ok: true });
    expect(parse({ ...valid(), [key]: [...three, item("Four.")] })).toEqual(INVALID);
  });

  it("accepts 20 unique sources and rejects 21", () => {
    const labels = Array.from({ length: 21 }, (_, index) => `R${index + 1}`);

    expect(parse(withStrengths([item("A point.", labels.slice(0, 20))]), labels)).toMatchObject({ ok: true });
    expect(parse(withStrengths([item("A point.", labels)]), labels)).toEqual(INVALID);
  });

  it("rejects an item with no sources", () => {
    expect(parse(withStrengths([item("A point.", [])]))).toEqual(INVALID);
  });

  it("rejects a source repeated within one item, but allows one label across items", () => {
    expect(parse(withStrengths([item("A point.", ["R1", "R2", "R1"])]))).toEqual(INVALID);
    expect(parse(withStrengths([item("One.", ["R1"]), item("Two.", ["R1"])]))).toMatchObject({ ok: true });
  });
});

describe("summary output sources (D-86, D-87)", () => {
  it.each([
    ["an unknown label", ["R9"]],
    ["a label removed by reduction (beyond the included labels)", ["R5"]],
    ["a raw Review ID", ["30000000-0000-4000-8000-000000000001"]],
    ["a lower-case label", ["r1"]],
    ["a padded label", [" R1"]],
    ["a label with a leading zero", ["R01"]],
    ["R0", ["R0"]],
    ["an empty string", [""]],
    ["one invented label among valid ones", ["R1", "R2", "R7"]],
  ])("rejects %s", (_label, sources) => {
    expect(parse(withStrengths([item("A point.", sources)]))).toEqual(INVALID);
  });

  it.each(["strengths", "criticisms", "mixedOpinions"])("checks the sources of every %s item", (key) => {
    expect(parse({ ...valid(), [key]: [item("Fine.", ["R1"]), item("Invented.", ["R9"])] })).toEqual(INVALID);
  });

  it("rejects every cited label when there are no included labels", () => {
    expect(parse(valid(), [])).toEqual(INVALID);
  });

  it("checks against the given labels, not a fixed list", () => {
    expect(parse(withStrengths([item("A point.", ["R5"])]), [...LABELS, "R5"])).toMatchObject({ ok: true });
  });
});

describe("summary output safe text (AI-04, D-87)", () => {
  it.each([
    ["an http URL", "See http://example.test for more."],
    ["an https URL", "See https://example.test for more."],
    ["an upper-case URL scheme", "See HTTPS://EXAMPLE.TEST for more."],
    ["a www host", "Visit www.example.test today."],
    ["a mixed-case www host", "Visit WwW.example.test today."],
    ["an HTML tag", "Reviewers <b>love</b> it."],
    ["a closing tag", "Praised</p>"],
    ["a script tag", "<script>alert(1)</script>"],
    ["a comment", "Praised <!-- hidden -->"],
    ["a processing instruction", "Praised <?xml ?>"],
    ["a NUL", "Praised\u0000."],
    ["a tab", "Praised\tby many."],
    ["a carriage return", "Praised\r\nby many."],
    ["an escape character", "Praised\u001b[31m."],
    ["a unit separator", "Praised\u001f."],
    ["DEL", "Praised\u007f."],
  ])("rejects %s in overall and in item text", (_label, text) => {
    expect(parse(withOverall(text))).toEqual(INVALID);
    expect(parse(withStrengths([item(text)]))).toEqual(INVALID);
  });

  it.each([
    ["a line feed", "Praised.\nCriticised."],
    ["a less-than comparison", "Rated 3 < 5 by most reviewers."],
    ["a less-than before a digit", "Mostly <5 stars."],
    ["an arrow", "Pacing -> slow."],
    ["a bare domain (accepted risk, D-95)", "See example.test for more."],
    ["the word http without a scheme", "The http protocol is mentioned."],
    ["non-Latin text", "多くの批評家が演技を称賛しています。"],
  ])("accepts %s", (_label, text) => {
    expect(parse(withOverall(text))).toMatchObject({ ok: true, value: { overall: text } });
  });
});

describe("validateSummaryOutput (D-87, D-94)", () => {
  it("validates an already-parsed value with the same rules", () => {
    expect(validateSummaryOutput(valid(), LABELS)).toEqual({ ok: true, value: valid() });
    expect(validateSummaryOutput({ ...valid(), extra: true }, LABELS)).toEqual(INVALID);
    expect(validateSummaryOutput(valid(), ["R1", "R2", "R3"])).toEqual(INVALID);
  });

  it("returns a SummaryOutput typed value with trimmed strings and labels as given", () => {
    const result = validateSummaryOutput(
      { overall: " Fine. ", strengths: [item(" Good. ", ["R2", "R1"])], criticisms: [], mixedOpinions: [] },
      LABELS,
    );
    const expected: SummaryOutput = {
      overall: "Fine.",
      strengths: [{ text: "Good.", sources: ["R2", "R1"] }],
      criticisms: [],
      mixedOpinions: [],
    };

    expect(result).toEqual({ ok: true, value: expected });
  });

  it("never throws for hostile values", () => {
    const cyclic: Record<string, unknown> = { ...valid() };
    cyclic.self = cyclic;
    const hostile: unknown[] = [undefined, Symbol("x"), () => valid(), new Map(), cyclic, Object.create(null)];

    for (const value of hostile) {
      expect(validateSummaryOutput(value, LABELS)).toEqual(INVALID);
    }
  });
});
