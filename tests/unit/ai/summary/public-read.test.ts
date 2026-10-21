import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { Database } from "../../../../src/server/db";
import type {
  PublicSummaryReadRepository,
  PublicSummarySnapshot,
  StoredCurrentSummary,
} from "../../../../src/server/repositories/summary";
import {
  createConsolePublicSummaryReadLog,
  createPublicSummaryReadService,
  projectPublicSummary,
  SUMMARY_PROMPT_VERSION,
  type PublicSummaryReadLog,
} from "../../../../src/server/services/ai/summary";
import type { MovieId, Tx } from "../../../../src/server/shared";

// The D-90 projection as amended by D-93, D-94 and D-98. PostgreSQL behaviour is in tests/integration/ai/summary/.

const MOVIE_ID = "20000000-0000-4000-8000-000000000031" as MovieId;
const GENERATED_AT = "2026-10-20T00:00:05.000Z";

function sample(count: number, truncatedAt: readonly number[] = []) {
  return {
    algorithm: "summary-sample-v1",
    seed: "ab".repeat(32),
    sampledCount: Math.max(count, 3),
    reviews: Array.from({ length: count }, (_, index) => ({
      reviewId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      version: 2,
      contentRevision: 1,
      truncated: truncatedAt.includes(index),
    })),
  };
}

const OUTPUT = {
  overall: "Reviewers mostly praise the pacing.",
  strengths: [{ text: "The lead performance is praised.", sources: ["R1", "R3"] }],
  criticisms: [],
  mixedOpinions: [{ text: "Opinions on the ending are split.", sources: ["R2"] }],
};

function row(overrides: Partial<StoredCurrentSummary> = {}): StoredCurrentSummary {
  return { id: "60000000-0000-4000-8000-000000000001", generatedAt: GENERATED_AT, output: OUTPUT, sample: sample(3), ...overrides };
}

function snapshot(overrides: Partial<PublicSummarySnapshot> = {}): PublicSummarySnapshot {
  return { eligibleCount: 12, currentSummaries: [row()], hasAnySummary: true, ...overrides };
}

function recordingLog(): PublicSummaryReadLog & { readonly skipped: [MovieId, string][] } {
  const skipped: [MovieId, string][] = [];
  return { skipped, invalidStoredOutput: (movieId, summaryId) => void skipped.push([movieId, summaryId]) };
}

describe("public summary precedence (D-90)", () => {
  it.each([0, 1, 2])("gives insufficient_reviews for %i eligible Reviews even with a current summary", (eligibleCount) => {
    expect(projectPublicSummary(MOVIE_ID, snapshot({ eligibleCount }), recordingLog())).toEqual({
      status: "insufficient_reviews",
      eligibleCount,
    });
  });

  it("gives ready with exactly the D-90 keys and no source labels, IDs or seed", () => {
    const view = projectPublicSummary(MOVIE_ID, snapshot({ currentSummaries: [row({ sample: sample(9, [4]) })] }), recordingLog());

    expect(view).toEqual({
      status: "ready",
      eligibleCount: 12,
      summary: {
        overall: OUTPUT.overall,
        strengths: [{ text: "The lead performance is praised." }],
        criticisms: [],
        mixedOpinions: [{ text: "Opinions on the ending are split." }],
        includedCount: 9,
        truncated: true,
        generatedAt: GENERATED_AT,
      },
    });
    const text = JSON.stringify(view);
    for (const hidden of ["sources", "R1", "30000000-", "ab".repeat(32), "60000000-", SUMMARY_PROMPT_VERSION]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("reports truncated false when no included Review was truncated", () => {
    const view = projectPublicSummary(MOVIE_ID, snapshot(), recordingLog());
    expect(view.status === "ready" && view.summary.truncated).toBe(false);
  });

  it("uses the first row given, which the repository orders latest first (D-94 tie-break)", () => {
    const latest = row({ id: "60000000-0000-4000-8000-000000000009", output: { ...OUTPUT, overall: "Latest text." } });
    const older = row({ output: { ...OUTPUT, overall: "Older text." } });
    const view = projectPublicSummary(MOVIE_ID, snapshot({ currentSummaries: [latest, older] }), recordingLog());
    expect(view.status === "ready" && view.summary.overall).toBe("Latest text.");
  });

  it("gives stale, with no old text, when only non-current summaries exist", () => {
    const view = projectPublicSummary(MOVIE_ID, snapshot({ currentSummaries: [], hasAnySummary: true }), recordingLog());
    expect(view).toEqual({ status: "stale", eligibleCount: 12 });
  });

  it("gives missing when the Movie has no summary", () => {
    expect(projectPublicSummary(MOVIE_ID, snapshot({ currentSummaries: [], hasAnySummary: false }), recordingLog())).toEqual({
      status: "missing",
      eligibleCount: 12,
    });
  });
});

describe("invalid stored rows (D-94 L7, D-98)", () => {
  const invalidRows: [string, Partial<StoredCurrentSummary>][] = [
    ["an invented source label", { output: { ...OUTPUT, criticisms: [{ text: "Slow.", sources: ["R4"] }] } }],
    ["an oversized overall", { output: { ...OUTPUT, overall: "x".repeat(801) } }],
    ["an extra output key", { output: { ...OUTPUT, sources: ["R1"] } }],
    ["markup in the text", { output: { ...OUTPUT, overall: "<script>alert(1)</script>" } }],
    ["output that is not an object", { output: "not json" }],
    ["a sample with an unknown algorithm", { sample: { ...sample(3), algorithm: "summary-sample-v0" } }],
    ["a sample with a malformed seed", { sample: { ...sample(3), seed: "AB".repeat(32) } }],
    ["a sample with an extra key", { sample: { ...sample(3), body: "text" } }],
    ["a sample entry with an extra key", { sample: { ...sample(3), reviews: sample(3).reviews.map((review) => ({ ...review, body: "x" })) } }],
    ["a sample with fewer than 3 Reviews", { sample: sample(2) }],
    ["a sample with more Reviews than sampledCount", { sample: { ...sample(4), sampledCount: 3 } }],
    ["a sample with a non-UUID review ID", { sample: { ...sample(3), reviews: sample(3).reviews.map((review) => ({ ...review, reviewId: "R1" })) } }],
    ["a missing sample", { sample: {} }],
  ];

  it.each(invalidRows)("skips a current row with %s, logs it, and falls back to stale", (_label, overrides) => {
    const log = recordingLog();
    const invalid = row(overrides);
    expect(projectPublicSummary(MOVIE_ID, snapshot({ currentSummaries: [invalid] }), log)).toEqual({
      status: "stale",
      eligibleCount: 12,
    });
    expect(log.skipped).toEqual([[MOVIE_ID, invalid.id]]);
  });

  it("uses the next valid current row after an invalid one", () => {
    const log = recordingLog();
    const invalid = row({ id: "60000000-0000-4000-8000-000000000002", output: { ...OUTPUT, overall: "" } });
    const valid = row({ output: { ...OUTPUT, overall: "Valid text." } });
    const view = projectPublicSummary(MOVIE_ID, snapshot({ currentSummaries: [invalid, valid] }), log);
    expect(view.status === "ready" && view.summary.overall).toBe("Valid text.");
    expect(log.skipped).toEqual([[MOVIE_ID, invalid.id]]);
  });

  it("checks sources against the stored sample's own labels", () => {
    const citesR5 = row({ output: { ...OUTPUT, strengths: [{ text: "Praised.", sources: ["R5"] }] } });
    expect(projectPublicSummary(MOVIE_ID, snapshot({ currentSummaries: [citesR5] }), recordingLog()).status).toBe("stale");
    expect(
      projectPublicSummary(MOVIE_ID, snapshot({ currentSummaries: [{ ...citesR5, sample: sample(5) }] }), recordingLog()).status,
    ).toBe("ready");
  });

  it("logs the IDs only, as one summary.read.invalid_stored_output line", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createConsolePublicSummaryReadLog().invalidStoredOutput(MOVIE_ID, "60000000-0000-4000-8000-000000000001");
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { event: "summary.read.invalid_stored_output", movieId: MOVIE_ID, summaryId: "60000000-0000-4000-8000-000000000001" },
    ]);
    warn.mockRestore();
  });
});

describe("public summary read service", () => {
  it("reads one snapshot in one transaction with the current prompt version, and returns null for a missing Movie", async () => {
    const tx = {} as Tx;
    const withTransaction = vi.fn((work: (tx: Tx) => Promise<unknown>) => work(tx));
    const readSnapshot = vi.fn<PublicSummaryReadRepository["readSnapshot"]>().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(null);
    const service = createPublicSummaryReadService({
      database: { withTransaction } as unknown as Database,
      summaries: { readSnapshot },
      log: recordingLog(),
    });

    await expect(service.getSummary(MOVIE_ID)).resolves.toMatchObject({ status: "ready" });
    await expect(service.getSummary(MOVIE_ID)).resolves.toBeNull();
    expect(withTransaction).toHaveBeenCalledTimes(2);
    expect(readSnapshot).toHaveBeenCalledWith(tx, MOVIE_ID, SUMMARY_PROMPT_VERSION);
  });
});
