import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import {
  MARKER_FAKE_CLEAN_OUTPUT,
  MARKER_FAKE_FLAG_OUTPUT,
  MARKER_FAKE_INVALID_OUTPUT,
  MARKER_FAKE_SUMMARY_OUTPUT,
} from "../../../../src/server/adapters/soc-llm/marker-fake-provider";
import { parseModerationOutput, validateModerationOutput } from "../../../../src/server/services/ai/moderation";

// The AI-02 output schema (D-100). Provider content is untrusted (AI-04).

const BODY = "The acting was rubbish and the director is a f*cking clown. Still, the score is lovely.";

const VALID = {
  assessment: "suspected_profanity",
  explanation: "The review uses an obfuscated vulgar word as an insult.",
  matches: [{ quote: "f*cking clown", reason: "Obfuscated vulgar word aimed at a person (items 1a, 1c and 2)." }],
  limitations: ["Human review is required."],
};

function valid(value: unknown, body = BODY): boolean {
  return validateModerationOutput(value, body).ok;
}

describe("marker fake conformance (D-57, D-70)", () => {
  it("accepts the clean output as no_profanity_detected for a body with no matches", () => {
    const result = parseModerationOutput(MARKER_FAKE_CLEAN_OUTPUT, "A fine film. [fake-llm:clean]");

    expect(result.ok && result.value.assessment).toBe("no_profanity_detected");
  });

  it("accepts the flag output as uncertain", () => {
    const result = parseModerationOutput(MARKER_FAKE_FLAG_OUTPUT, "A fine film. [fake-llm:flag]");

    expect(result.ok && result.value.assessment).toBe("uncertain");
  });

  it("rejects the invalid and summary outputs", () => {
    expect(parseModerationOutput(MARKER_FAKE_INVALID_OUTPUT, BODY).ok).toBe(false);
    expect(parseModerationOutput(MARKER_FAKE_SUMMARY_OUTPUT, BODY).ok).toBe(false);
  });
});

describe("valid output (AI-02)", () => {
  it("accepts the documented shape and returns it", () => {
    expect(validateModerationOutput(VALID, BODY)).toEqual({ ok: true, value: VALID });
  });

  it("accepts uncertain with or without matches", () => {
    expect(valid({ ...VALID, assessment: "uncertain" })).toBe(true);
    expect(valid({ ...VALID, assessment: "uncertain", matches: [] })).toBe(true);
  });

  it("accepts the ai.md example output", () => {
    const example = {
      assessment: "uncertain",
      explanation: "The expression needs contextual review.",
      matches: [],
      limitations: ["Human review is required."],
    };

    expect(valid(example)).toBe(true);
  });

  it("accepts one fenced JSON object, as D-87 parses", () => {
    expect(parseModerationOutput("```json\n" + JSON.stringify(VALID) + "\n```", BODY).ok).toBe(true);
  });

  it("trims explanation, reasons and limitations but never the quote", () => {
    const result = validateModerationOutput(
      {
        ...VALID,
        explanation: "  padded  ",
        matches: [{ quote: "f*cking clown", reason: " padded reason " }],
        limitations: [" padded "],
      },
      BODY,
    );

    expect(result).toEqual({
      ok: true,
      value: { ...VALID, explanation: "padded", matches: [{ quote: "f*cking clown", reason: "padded reason" }], limitations: ["padded"] },
    });
    expect(valid({ ...VALID, matches: [{ quote: " f*cking clown", reason: "x" }] }, BODY)).toBe(true);
    expect(valid({ ...VALID, matches: [{ quote: "f*cking clown ", reason: "x" }] }, "f*cking clown")).toBe(false);
  });

  it("allows a quote that contains markup or a URL copied from the body", () => {
    const body = "Visit http://example.test <b>sh1t</b>";

    expect(valid({ ...VALID, matches: [{ quote: "<b>sh1t</b>", reason: "Obfuscated word." }] }, body)).toBe(true);
    expect(valid({ ...VALID, matches: [{ quote: "http://example.test", reason: "Link." }] }, body)).toBe(true);
  });
});

describe("rejected output (AI-02, AI-04)", () => {
  it("rejects a quote that is not an exact substring of the body", () => {
    expect(valid({ ...VALID, matches: [{ quote: "fucking clown", reason: "Vulgar." }] })).toBe(false);
    expect(valid({ ...VALID, matches: [{ quote: "F*CKING CLOWN", reason: "Vulgar." }] })).toBe(false);
  });

  it("rejects an empty quote", () => {
    expect(valid({ ...VALID, assessment: "uncertain", matches: [{ quote: "", reason: "Empty." }] })).toBe(false);
  });

  it("rejects unknown keys at every level", () => {
    expect(valid({ ...VALID, action: "hide_review" })).toBe(false);
    expect(valid({ ...VALID, matches: [{ ...VALID.matches[0], severity: "high" }] })).toBe(false);
  });

  it("rejects a missing key", () => {
    const withoutLimitations: Partial<typeof VALID> = { ...VALID };
    delete withoutLimitations.limitations;

    expect(valid(withoutLimitations)).toBe(false);
  });

  it("rejects an unknown assessment", () => {
    expect(valid({ ...VALID, assessment: "clean" })).toBe(false);
    expect(valid({ ...VALID, assessment: "SUSPECTED_PROFANITY" })).toBe(false);
  });

  it("requires a match for suspected_profanity and none for no_profanity_detected", () => {
    expect(valid({ ...VALID, matches: [] })).toBe(false);
    expect(valid({ ...VALID, assessment: "no_profanity_detected" })).toBe(false);
  });

  it("enforces the explanation bound of 800 code points", () => {
    expect(valid({ ...VALID, explanation: "é".repeat(800) })).toBe(true);
    expect(valid({ ...VALID, explanation: "é".repeat(801) })).toBe(false);
    expect(valid({ ...VALID, explanation: "   " })).toBe(false);
  });

  it("enforces at most 10 matches", () => {
    const match = VALID.matches[0]!;

    expect(valid({ ...VALID, matches: Array.from({ length: 10 }, () => match) })).toBe(true);
    expect(valid({ ...VALID, matches: Array.from({ length: 11 }, () => match) })).toBe(false);
  });

  it("enforces the quote bound of 200 and the reason bound of 240 code points", () => {
    const longBody = "x".repeat(201);

    expect(valid({ ...VALID, matches: [{ quote: "x".repeat(200), reason: "r" }] }, longBody)).toBe(true);
    expect(valid({ ...VALID, matches: [{ quote: "x".repeat(201), reason: "r" }] }, longBody)).toBe(false);
    expect(valid({ ...VALID, matches: [{ ...VALID.matches[0], reason: "r".repeat(240) }] })).toBe(true);
    expect(valid({ ...VALID, matches: [{ ...VALID.matches[0], reason: "r".repeat(241) }] })).toBe(false);
  });

  it("enforces at most 5 limitations of 1 to 240 code points", () => {
    expect(valid({ ...VALID, limitations: Array.from({ length: 5 }, () => "l".repeat(240)) })).toBe(true);
    expect(valid({ ...VALID, limitations: Array.from({ length: 6 }, () => "l") })).toBe(false);
    expect(valid({ ...VALID, limitations: ["l".repeat(241)] })).toBe(false);
    expect(valid({ ...VALID, limitations: [""] })).toBe(false);
  });

  it("rejects URLs and markup outside quotes", () => {
    expect(valid({ ...VALID, explanation: "See https://example.test for details." })).toBe(false);
    expect(valid({ ...VALID, explanation: "<script>alert(1)</script>" })).toBe(false);
    expect(valid({ ...VALID, matches: [{ ...VALID.matches[0], reason: "www.example.test" }] })).toBe(false);
    expect(valid({ ...VALID, limitations: ["<img src=x>"] })).toBe(false);
  });

  it("rejects control characters and lone surrogates outside quotes", () => {
    expect(valid({ ...VALID, explanation: "bell\u0007" })).toBe(false);
    expect(valid({ ...VALID, explanation: "half \ud800 pair" })).toBe(false);
  });

  it("rejects wrong types and non-objects", () => {
    expect(valid(null)).toBe(false);
    expect(valid([VALID])).toBe(false);
    expect(valid({ ...VALID, matches: "none" })).toBe(false);
    expect(valid({ ...VALID, limitations: [1] })).toBe(false);
  });

  it("rejects content that is not JSON, or more than one object", () => {
    expect(parseModerationOutput("no_profanity_detected", BODY).ok).toBe(false);
    expect(parseModerationOutput(JSON.stringify(VALID) + JSON.stringify(VALID), BODY).ok).toBe(false);
    expect(parseModerationOutput("", BODY).ok).toBe(false);
  });
});
