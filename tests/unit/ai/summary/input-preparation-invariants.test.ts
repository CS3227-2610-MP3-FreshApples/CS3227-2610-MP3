import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { EligibleReviewRecord, SummaryInputSnapshot } from "../../../../src/server/repositories/summary";
import {
  prepareSummaryInput,
  type SummaryLimits,
  type SummaryPreparation,
} from "../../../../src/server/services/ai/summary";
import type {
  ContentRevision,
  MovieId,
  ReviewId,
  ReviewsRevision,
  RowVersion,
} from "../../../../src/server/shared";

// Independent Q-1 cases for D-86 input preparation and D-88 provenance. The existing reduction cases use
// Reviews of equal length, so they cannot tell "remove the last in sample order" from "remove the longest".

const MOVIE_ID = "20000000-0000-4000-8000-0000000000aa" as MovieId;
const ROOMY: SummaryLimits = { sampleSize: 20, inputTokenLimit: Number.MAX_SAFE_INTEGER };
const SEEDS = [Buffer.alloc(32, 0x00), Buffer.alloc(32, 0x7e), Buffer.from(Array.from({ length: 32 }, (_, i) => 255 - i))];

type Ready = Extract<SummaryPreparation, { readonly kind: "ready" }>;

interface SentReview {
  readonly label: string;
  readonly rating: string;
  readonly truncated: boolean;
  readonly body: string;
}

function reviewId(index: number): ReviewId {
  return `30000000-0000-4000-8000-${String(index).padStart(12, "0")}` as ReviewId;
}

/** Bodies of mixed lengths and scripts, some over 1,000 code points. */
function body(index: number): string {
  const variants = [
    "Short.",
    "Quote \" backslash \\ newline \n tab \t end.",
    "é".repeat(400 + index),
    "\u{1F3AC}".repeat(1_100),
    `${"word ".repeat(260)}${index}`,
    "多くの批評家が演技を称賛しています。".repeat(10),
  ];
  return variants[index % variants.length] ?? "";
}

function candidates(n: number): EligibleReviewRecord[] {
  return Array.from({ length: n }, (_, index) => ({
    id: reviewId(index + 1),
    version: (index + 2) as RowVersion,
    contentRevision: ((index % 3) + 1) as ContentRevision,
    rating: (index % 10) + 1,
    body: body(index),
  }));
}

function snapshot(reviews: readonly EligibleReviewRecord[]): SummaryInputSnapshot {
  return { reviewsRevision: 9 as ReviewsRevision, hasCurrentSummary: false, reviews };
}

function sent(result: Ready): SentReview[] {
  return (JSON.parse(result.input.messages[1]?.content ?? "null") as { reviews: SentReview[] }).reviews;
}

function ready(result: SummaryPreparation): Ready {
  if (result.kind !== "ready") {
    throw new Error(`expected ready, got ${result.kind}`);
  }
  return result;
}

describe("summary reduction removes from the end of the sample order, whatever the lengths (D-86)", () => {
  it("removes the shortest Review when it is last in sample order, though removing a longer one would also fit", () => {
    const seed = SEEDS[1] as Buffer;
    const ids = ready(prepareSummaryInput(MOVIE_ID, snapshot(candidates(6)), ROOMY, seed)).sample.reviews.map(
      ({ reviewId: id }) => id,
    );
    const last = ids[ids.length - 1];
    // The last sampled Review is short; every other one is long.
    const shaped = candidates(6).map((review) => ({ ...review, body: review.id === last ? "Ok." : "x".repeat(900) }));
    const unbounded = ready(prepareSummaryInput(MOVIE_ID, snapshot(shaped), ROOMY, seed));
    expect(unbounded.sample.reviews.map(({ reviewId: id }) => id)).toEqual(ids);

    const result = ready(
      prepareSummaryInput(
        MOVIE_ID,
        snapshot(shaped),
        { sampleSize: 20, inputTokenLimit: unbounded.input.estimatedInputTokens - 1 },
        seed,
      ),
    );

    expect(result.sample.reviews.map(({ reviewId: id }) => id)).toEqual(ids.slice(0, 5));
    expect(result.labels).toEqual(["R1", "R2", "R3", "R4", "R5"]);
  });

  it("keeps a long first Review whole and removes later ones instead", () => {
    const seed = SEEDS[2] as Buffer;
    const ids = ready(prepareSummaryInput(MOVIE_ID, snapshot(candidates(8)), ROOMY, seed)).sample.reviews.map(
      ({ reviewId: id }) => id,
    );
    const first = ids[0];
    const shaped = candidates(8).map((review) => ({ ...review, body: review.id === first ? "y".repeat(1_000) : "Fine." }));
    const unbounded = ready(prepareSummaryInput(MOVIE_ID, snapshot(shaped), ROOMY, seed));

    const result = ready(
      prepareSummaryInput(
        MOVIE_ID,
        snapshot(shaped),
        { sampleSize: 20, inputTokenLimit: unbounded.input.estimatedInputTokens - 20 },
        seed,
      ),
    );

    expect(result.sample.reviews[0]?.reviewId).toBe(first);
    expect(sent(result)[0]?.body).toBe("y".repeat(1_000));
    expect(result.sample.reviews.map(({ reviewId: id }) => id)).toEqual(ids.slice(0, result.sample.reviews.length));
    expect(result.sample.reviews.length).toBeLessThan(8);
  });
});

describe("summary input invariants over fixed seeds, sizes and limits (D-86, D-88)", () => {
  const cases = SEEDS.flatMap((seed, seedIndex) =>
    [3, 4, 7, 20, 21, 33].flatMap((n) =>
      [3, 5, 20].flatMap((sampleSize) =>
        [Number.MAX_SAFE_INTEGER, 8_000, 3_000, 1_500].map((inputTokenLimit) => ({
          seedIndex,
          seed,
          n,
          limits: { sampleSize, inputTokenLimit },
        })),
      ),
    ),
  );

  it.each(cases.map((c) => [c.seedIndex, c.n, c.limits.sampleSize, c.limits.inputTokenLimit, c] as const))(
    "seed %i, %i eligible, sample size %i, limit %i",
    (_seed, _n, _size, _limit, { seed, n, limits }) => {
      const all = candidates(n);
      const result = prepareSummaryInput(MOVIE_ID, snapshot(all), limits, seed);
      if (result.kind === "input_unfit") {
        // Reduction only fails safe: even 3 of the sampled Reviews must not fit.
        const unbounded = ready(prepareSummaryInput(MOVIE_ID, snapshot(all), { ...ROOMY, sampleSize: limits.sampleSize }, seed));
        const firstThree = unbounded.sample.reviews.slice(0, 3).map(({ reviewId: id }) => id);
        const onlyThree = all.filter(({ id }) => firstThree.includes(id));
        // Labels R1–R3 have equal length, so the estimate does not depend on the order of the three.
        const threeEstimate = ready(prepareSummaryInput(MOVIE_ID, snapshot(onlyThree), ROOMY, seed)).input;
        expect(threeEstimate.estimatedInputTokens).toBeGreaterThan(limits.inputTokenLimit);
        return;
      }
      const prepared = ready(result);
      const included = prepared.sample.reviews;
      const records = sent(prepared);
      const s = Math.min(n, limits.sampleSize);

      // Counts and the K10 bound.
      expect(prepared.eligibleCount).toBe(n);
      expect(prepared.sample.sampledCount).toBe(s);
      expect(included.length).toBeGreaterThanOrEqual(3);
      expect(included.length).toBeLessThanOrEqual(s);
      expect(prepared.input.estimatedInputTokens).toBeLessThanOrEqual(limits.inputTokenLimit);

      // Labels are R1..Rm, contiguous, and label R<k> is reviews[k − 1] (D-88).
      const labels = included.map((_, index) => `R${index + 1}`);
      expect(prepared.labels).toEqual(labels);
      expect(records.map(({ label }) => label)).toEqual(labels);
      expect(new Set(included.map(({ reviewId: id }) => id)).size).toBe(included.length);
      included.forEach((entry, index) => {
        const source = all.find(({ id }) => id === entry.reviewId);
        const record = records[index];
        expect(source).toBeDefined();
        expect(entry.version).toBe(source?.version);
        expect(entry.contentRevision).toBe(source?.contentRevision);
        expect(record?.rating).toBe(`${source?.rating}/10`);
        const codePoints = Array.from(source?.body ?? "");
        expect(record?.body).toBe(codePoints.slice(0, 1_000).join(""));
        expect(record?.truncated).toBe(codePoints.length > 1_000);
        expect(entry.truncated).toBe(record?.truncated);
      });

      // The included Reviews are the prefix of the unreduced sample from the same seed.
      const unbounded = ready(prepareSummaryInput(MOVIE_ID, snapshot(all), { ...ROOMY, sampleSize: limits.sampleSize }, seed));
      expect(unbounded.sample.reviews.slice(0, included.length)).toEqual(included);

      // Reduction stops as soon as the input fits: one more Review would not.
      if (included.length < s) {
        const withNext = unbounded.sample.reviews.slice(0, included.length + 1).map(({ reviewId: id }) => id);
        const next = all.filter(({ id }) => withNext.includes(id));
        // The same records with labels R1..R(m+1) in another order have the same byte length.
        const larger = prepareSummaryInput(MOVIE_ID, snapshot(next), { ...ROOMY, sampleSize: next.length }, seed);
        expect(ready(larger).input.estimatedInputTokens).toBeGreaterThan(limits.inputTokenLimit);
      }

      // The K10 snapshot holds no Review text (D-88).
      const snapshotJson = JSON.stringify(prepared.input.snapshot);
      for (const { body: text } of all) {
        expect(snapshotJson).not.toContain(text.slice(0, 40));
      }
      expect(prepared.input.snapshot).toEqual({
        movieId: MOVIE_ID,
        reviewsRevision: 9,
        eligibleCount: n,
        sample: prepared.sample,
      });
    },
  );
});
