import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { sampleWithoutReplacement, uniformIndex, type Uint32Source } from "../../../../src/server/services/ai/summary";

// Independent Q-1 cases for D-86 `summary-sample-v1`. Partial Fisher–Yates is uniform exactly when every
// sequence of draws (index(n), index(n − 1), …, index(n − s + 1)) gives a different ordered sample, so each of
// the n!/(n − s)! ordered samples has one draw sequence. These cases enumerate every draw sequence.

/** Every tuple whose i-th entry is in [0, n − i), for i in [0, s). */
function drawSequences(n: number, s: number): number[][] {
  let sequences: number[][] = [[]];
  for (let i = 0; i < s; i += 1) {
    sequences = sequences.flatMap((prefix) => Array.from({ length: n - i }, (_, value) => [...prefix, value]));
  }
  return sequences;
}

/** Returns the given values in order; small values are below every rejection limit, so each is one draw. */
function scripted(values: readonly number[]): Uint32Source {
  let position = 0;
  return () => {
    const value = values[position];
    if (value === undefined) {
      throw new Error("scripted source exhausted");
    }
    position += 1;
    return value;
  };
}

function permutationCount(n: number, s: number): number {
  let count = 1;
  for (let i = 0; i < s; i += 1) {
    count *= n - i;
  }
  return count;
}

describe("summary-sample-v1 draw sequences map one-to-one onto ordered samples (D-86)", () => {
  it.each([
    [3, 3],
    [4, 2],
    [5, 3],
    [6, 1],
    [6, 6],
  ])("gives each of the ordered samples of %i candidates taken %i at a time exactly once", (n, s) => {
    const candidates = Array.from({ length: n }, (_, index) => `c${index}`);
    const samples = drawSequences(n, s).map((draws) =>
      sampleWithoutReplacement(candidates, s, scripted(draws)).join(","),
    );

    expect(samples).toHaveLength(permutationCount(n, s));
    expect(new Set(samples).size).toBe(permutationCount(n, s));
    for (const sample of samples) {
      const members = sample.split(",");
      expect(new Set(members).size).toBe(s);
      expect(members.every((member) => candidates.includes(member))).toBe(true);
    }
  });

  it("draws exactly s values when no value is rejected", () => {
    let drawn = 0;
    const next: Uint32Source = () => {
      drawn += 1;
      return 0;
    };

    sampleWithoutReplacement(["a", "b", "c", "d", "e"], 3, next);

    expect(drawn).toBe(3);
  });

  it("draws nothing for an empty candidate list", () => {
    expect(sampleWithoutReplacement([], 20, scripted([]))).toEqual([]);
  });
});

describe("uniform index edge values (D-86)", () => {
  it("returns 0 for k = 1 from the largest 32-bit value without discarding it", () => {
    expect(uniformIndex(scripted([2 ** 32 - 1]), 1)).toBe(0);
  });

  it("discards the largest 32-bit value for k = 3, whose limit is 2^32 − 1", () => {
    // floor(2^32 / 3) × 3 = 4,294,967,295, so only that one value is discarded.
    expect(uniformIndex(scripted([2 ** 32 - 1, 2 ** 32 - 2]), 3)).toBe((2 ** 32 - 2) % 3);
  });

  it("keeps discarding until a value falls below the limit", () => {
    // floor(2^32 / 20) × 20 = 4,294,967,280.
    expect(uniformIndex(scripted([4_294_967_280, 4_294_967_295, 4_294_967_281, 41]), 20)).toBe(1);
  });
});
