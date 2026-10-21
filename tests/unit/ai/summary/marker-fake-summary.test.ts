import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import {
  createMarkerFakeLlmProvider,
  MARKER_FAKE_SUMMARY_OUTPUT,
  MARKER_FAKE_USAGE,
} from "../../../../src/server/adapters/soc-llm/marker-fake-provider";
import type { EligibleReviewRecord } from "../../../../src/server/repositories/summary";
import {
  parseSummaryOutput,
  prepareSummaryInput,
  SUMMARY_MAX_OUTPUT_TOKENS,
  type SummaryLimits,
  type SummaryOutput,
  type SummaryPreparation,
} from "../../../../src/server/services/ai/summary";
import type {
  ContentRevision,
  MovieId,
  ReviewId,
  ReviewsRevision,
  RowVersion,
} from "../../../../src/server/shared";

// D-70 conformance of the marker fake's `summary` constant against the D-87 schema, with fixed seeds (D-93).

const MOVIE_ID = "20000000-0000-4000-8000-000000000002" as MovieId;
const SEEDS = [Buffer.alloc(32, 0x00), Buffer.alloc(32, 0x5a), Buffer.from(Array.from({ length: 32 }, (_, i) => i))];
const LIMITS: SummaryLimits = { sampleSize: 20, inputTokenLimit: 8_000 };

function labels(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `R${index + 1}`);
}

function markedReviews(count: number, body = "A synthetic opinion. [fake-llm:summary]"): EligibleReviewRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` as ReviewId,
    version: 1 as RowVersion,
    contentRevision: 1 as ContentRevision,
    rating: (index % 10) + 1,
    body,
  }));
}

type Ready = Extract<SummaryPreparation, { readonly kind: "ready" }>;

function prepare(count: number, seed: Buffer, limits = LIMITS, body?: string): Ready {
  const result = prepareSummaryInput(
    MOVIE_ID,
    { reviewsRevision: 2 as ReviewsRevision, hasCurrentSummary: false, reviews: markedReviews(count, body) },
    limits,
    seed,
  );
  if (result.kind !== "ready") {
    throw new Error(`expected ready, got ${result.kind}`);
  }
  return result;
}

async function fakeContent(prepared: Ready): Promise<string> {
  const result = await createMarkerFakeLlmProvider({ modelId: "fake-model" }).complete({
    messages: prepared.input.messages,
    maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    signal: new AbortController().signal,
  });
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.kind}`);
  }
  expect(result.value.usage).toEqual(MARKER_FAKE_USAGE);
  return result.value.content;
}

function citedLabels(output: SummaryOutput): string[] {
  return [...output.strengths, ...output.criticisms, ...output.mixedOpinions].flatMap(({ sources }) => sources);
}

describe("marker fake summary output conformance (D-70, D-87)", () => {
  it("is valid under the D-87 schema for the smallest publishable sample, R1–R3", () => {
    expect(parseSummaryOutput(MARKER_FAKE_SUMMARY_OUTPUT, labels(3))).toEqual({
      ok: true,
      value: JSON.parse(MARKER_FAKE_SUMMARY_OUTPUT),
    });
  });

  it.each([3, 4, 10, 20])("is valid for every included-sample size, here %i", (count) => {
    expect(parseSummaryOutput(MARKER_FAKE_SUMMARY_OUTPUT, labels(count))).toMatchObject({ ok: true });
  });

  it("cites only R1–R3, so it never invents a source for a published sample", () => {
    const result = parseSummaryOutput(MARKER_FAKE_SUMMARY_OUTPUT, labels(3));

    expect(result.ok && new Set(citedLabels(result.value))).toEqual(new Set(["R1", "R2", "R3"]));
  });

  it("would be rejected with fewer than 3 included labels, which input preparation never publishes", () => {
    expect(parseSummaryOutput(MARKER_FAKE_SUMMARY_OUTPUT, labels(2))).toEqual({
      ok: false,
      error: { kind: "invalid_output" },
    });
  });

  it("uses every list, so each is exercised by journeys that use the fake", () => {
    const output = JSON.parse(MARKER_FAKE_SUMMARY_OUTPUT) as SummaryOutput;

    expect(output.strengths.length).toBeGreaterThan(0);
    expect(output.criticisms.length).toBeGreaterThan(0);
    expect(output.mixedOpinions.length).toBeGreaterThan(0);
  });
});

describe("marker fake summary through input preparation (D-70, D-86, D-93 fixed seeds)", () => {
  it.each(SEEDS.flatMap((seed) => [3, 4, 20, 25].map((count) => [count, seed] as const)))(
    "returns valid output for %i marked Reviews (seed %#)",
    async (count, seed) => {
      const prepared = prepare(count, seed);

      const content = await fakeContent(prepared);

      expect(content).toBe(MARKER_FAKE_SUMMARY_OUTPUT);
      expect(parseSummaryOutput(content, prepared.labels)).toMatchObject({ ok: true });
    },
  );

  it("returns valid output when reduction leaves exactly 3 Reviews", async () => {
    const body = `${"Long synthetic opinion. ".repeat(40)}[fake-llm:summary]`;
    const threeFit = prepare(3, SEEDS[0]!, { sampleSize: 20, inputTokenLimit: Number.MAX_SAFE_INTEGER }, body).input
      .estimatedInputTokens;

    const prepared = prepare(6, SEEDS[0]!, { sampleSize: 20, inputTokenLimit: threeFit }, body);
    expect(prepared.labels).toEqual(["R1", "R2", "R3"]);

    expect(parseSummaryOutput(await fakeContent(prepared), prepared.labels)).toMatchObject({ ok: true });
  });
});
