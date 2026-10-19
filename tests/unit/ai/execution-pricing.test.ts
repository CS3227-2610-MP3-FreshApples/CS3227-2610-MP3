import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { LlmCompletion, LlmFailure } from "../../../src/server/adapters/soc-llm";
import { costMicrodollars, estimateInputTokens } from "../../../src/server/services/ai/runtime/pricing";
import { attemptCharge, planSettlement } from "../../../src/server/services/ai/runtime/settlement";
import type { Result } from "../../../src/server/shared";

// The D-48 verified prices, used as synthetic test inputs.
const PRICES = { inputMicrodollarsPerMTok: 411_810, outputMicrodollarsPerMTok: 1_456_571 };
const MAX_INTEGER_COLUMN = 2_147_483_647;

describe("estimateInputTokens (AI-03, O-26, D-68)", () => {
  it("is ceil(total UTF-8 bytes ÷ 3) plus 16 per message", () => {
    expect(estimateInputTokens([])).toBe(0);
    expect(estimateInputTokens([{ role: "user", content: "abc" }])).toBe(1 + 16);
    expect(estimateInputTokens([{ role: "user", content: "abcd" }])).toBe(2 + 16);
    expect(estimateInputTokens([{ role: "system", content: "" }])).toBe(16);
  });

  it("counts UTF-8 bytes, not code units", () => {
    // é is 2 bytes, 😀 is 4 bytes (2 UTF-16 code units).
    expect(estimateInputTokens([{ role: "user", content: "é😀" }])).toBe(2 + 16);
  });

  it("sums bytes across messages before rounding", () => {
    expect(
      estimateInputTokens([
        { role: "system", content: "ab" },
        { role: "user", content: "c" },
      ]),
    ).toBe(1 + 32);
  });
});

describe("costMicrodollars (AI-03, D-25, D-63)", () => {
  it("is ceil((input × input price + output × output price) ÷ 1,000,000)", () => {
    // (8,000 × 411,810 + 1,200 × 1,456,571) ÷ 10^6 = 5,042.3652
    expect(costMicrodollars(8_000, 1_200, PRICES)).toBe(5_043);
  });

  it("does not round an exact value up", () => {
    expect(costMicrodollars(1_000_000, 0, { inputMicrodollarsPerMTok: 5, outputMicrodollarsPerMTok: 1 })).toBe(5);
  });

  it("is 0 for no tokens", () => {
    expect(costMicrodollars(0, 0, PRICES)).toBe(0);
  });

  it("is null when the cost is not a safe integer (D-75)", () => {
    const huge = { inputMicrodollarsPerMTok: Number.MAX_SAFE_INTEGER, outputMicrodollarsPerMTok: Number.MAX_SAFE_INTEGER };
    expect(costMicrodollars(MAX_INTEGER_COLUMN, MAX_INTEGER_COLUMN, huge)).toBeNull();
  });
});

const R = 5_043;

function failure(error: LlmFailure): Result<LlmCompletion, LlmFailure> {
  return { ok: false, error };
}

describe("attemptCharge (D-63, D-74, D-75)", () => {
  it("prices reported usage", () => {
    expect(attemptCharge({ ok: true, value: { content: "x", usage: { inputTokens: 1_000, outputTokens: 100 } } }, PRICES)).toEqual({
      kind: "priced",
      microdollars: 558, // ceil(411.81 + 145.6571)
      usage: { inputTokens: 1_000, outputTokens: 100 },
    });
  });

  it("charges a success without usage as unknown", () => {
    expect(attemptCharge({ ok: true, value: { content: "x", usage: null } }, PRICES)).toEqual({ kind: "unknown" });
  });

  it("charges usage whose cost is not a safe integer as unknown", () => {
    const huge = { inputMicrodollarsPerMTok: Number.MAX_SAFE_INTEGER, outputMicrodollarsPerMTok: 1 };
    expect(
      attemptCharge({ ok: true, value: { content: "x", usage: { inputTokens: MAX_INTEGER_COLUMN, outputTokens: 0 } } }, huge),
    ).toEqual({ kind: "unknown" });
  });

  it.each<LlmFailure>([
    { kind: "rate_limited", retryAfterSeconds: null },
    { kind: "rate_limited", retryAfterSeconds: 5 },
    { kind: "rejected" },
    { kind: "misconfigured" },
  ])("treats $kind as refused before generation (charged 0)", (error) => {
    expect(attemptCharge(failure(error), PRICES)).toEqual({ kind: "refused" });
  });

  it.each<LlmFailure>([{ kind: "timeout" }, { kind: "unavailable" }, { kind: "malformed_response" }])(
    "charges $kind as unknown",
    (error) => {
      expect(attemptCharge(failure(error), PRICES)).toEqual({ kind: "unknown" });
    },
  );
});

describe("planSettlement (D-63)", () => {
  const priced = (microdollars: number, inputTokens: number, outputTokens: number) =>
    ({ kind: "priced", microdollars, usage: { inputTokens, outputTokens } }) as const;

  it("releases when no request was sent", () => {
    expect(planSettlement([], R)).toEqual({ status: "released", chargeMicrodollars: 0 });
  });

  it("releases when every request was refused", () => {
    expect(planSettlement([{ kind: "refused" }, { kind: "refused" }], R)).toEqual({
      status: "released",
      chargeMicrodollars: 0,
    });
  });

  it("charges one unknown attempt at R with null usage", () => {
    expect(planSettlement([{ kind: "unknown" }], R)).toEqual({
      status: "reconciled",
      chargeMicrodollars: R,
      inputTokens: null,
      outputTokens: null,
      actualMicrodollars: null,
    });
  });

  it("charges two unknown attempts at 2R", () => {
    expect(planSettlement([{ kind: "unknown" }, { kind: "unknown" }], R)).toMatchObject({
      status: "reconciled",
      chargeMicrodollars: 2 * R,
      actualMicrodollars: null,
    });
  });

  it("records usage and the actual charge when every costed attempt reported usage", () => {
    expect(planSettlement([priced(10, 100, 50), priced(7, 70, 20)], R)).toEqual({
      status: "reconciled",
      chargeMicrodollars: 17,
      inputTokens: 170,
      outputTokens: 70,
      actualMicrodollars: 17,
    });
  });

  it("does not count a refused attempt as costed", () => {
    expect(planSettlement([{ kind: "refused" }, priced(10, 100, 50)], R)).toEqual({
      status: "reconciled",
      chargeMicrodollars: 10,
      inputTokens: 100,
      outputTokens: 50,
      actualMicrodollars: 10,
    });
  });

  it("records no usage when one costed attempt is unknown", () => {
    expect(planSettlement([{ kind: "unknown" }, priced(10, 100, 50)], R)).toEqual({
      status: "reconciled",
      chargeMicrodollars: R + 10,
      inputTokens: null,
      outputTokens: null,
      actualMicrodollars: null,
    });
  });

  it("reconciles a priced attempt that cost 0", () => {
    expect(planSettlement([priced(0, 0, 0)], R)).toEqual({
      status: "reconciled",
      chargeMicrodollars: 0,
      inputTokens: 0,
      outputTokens: 0,
      actualMicrodollars: 0,
    });
  });

  it("leaves token columns null when a sum leaves the integer range, keeping the charge", () => {
    expect(planSettlement([priced(10, MAX_INTEGER_COLUMN, 1), priced(10, 1, 1)], R)).toEqual({
      status: "reconciled",
      chargeMicrodollars: 20,
      inputTokens: null,
      outputTokens: null,
      actualMicrodollars: 20,
    });
  });
});
