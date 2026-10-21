import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import {
  sampleWithoutReplacement,
  seededUint32Source,
  SUMMARY_SAMPLE_ALGORITHM,
  SUMMARY_SEED_BYTES,
  systemSeedSource,
  uniformIndex,
  type Uint32Source,
} from "../../../../src/server/services/ai/summary";

const SEED_0_TO_31 = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const SEED_ALL_FF = Buffer.alloc(32, 0xff);

function range(n: number): number[] {
  return Array.from({ length: n }, (_, index) => index);
}

/** Returns the scripted values in order and fails the test if more are drawn. */
function scripted(values: readonly number[]): Uint32Source & { readonly drawn: () => number } {
  let position = 0;
  const next = () => {
    const value = values[position];
    if (value === undefined) {
      throw new Error("scripted source exhausted");
    }
    position += 1;
    return value;
  };
  return Object.assign(next, { drawn: () => position });
}

describe("summary-sample-v1 fixed vectors (D-86, D-93)", () => {
  // Expected values come from an independent Python implementation of the D-86 text, not from this code.
  it("pins the first values of the SHA-256 counter stream, across a digest boundary", () => {
    const next = seededUint32Source(SEED_0_TO_31);

    expect(range(9).map(() => next())).toEqual([
      1895039037, 1387719427, 3666161299, 627792262, 3050604592, 2562423155, 3159562444, 1717795460, 78025994,
    ]);
  });

  it.each([
    ["seed 00..1f, n = 25, size 20", SEED_0_TO_31, 25, 20, [12, 20, 10, 23, 11, 1, 2, 9, 14, 7, 6, 5, 0, 15, 18, 16, 22, 21, 17, 13]],
    ["seed ff..ff, n = 5, size 3", SEED_ALL_FF, 5, 3, [4, 3, 0]],
    ["seed 00..1f, n = 3, size 20", SEED_0_TO_31, 3, 20, [0, 2, 1]],
  ])("pins the sample for %s", (_name, seed, n, size, expected) => {
    expect(sampleWithoutReplacement(range(n), size, seededUint32Source(seed))).toEqual(expected);
  });

  it("names the algorithm recorded in provenance", () => {
    expect(SUMMARY_SAMPLE_ALGORITHM).toBe("summary-sample-v1");
  });
});

describe("uniform index by rejection (D-86)", () => {
  it("discards values of at least floor(2^32 / k) × k and reduces the next one modulo k", () => {
    // k = 3: floor(2^32 / 3) × 3 = 4294967295, so only 2^32 − 1 is discarded.
    const next = scripted([4294967295, 4294967294]);

    expect(uniformIndex(next, 3)).toBe(4294967294 % 3);
    expect(next.drawn()).toBe(2);
  });

  it("accepts the largest value below the limit", () => {
    // k = 6: floor(2^32 / 6) × 6 = 4294967292.
    const next = scripted([4294967291]);

    expect(uniformIndex(next, 6)).toBe(4294967291 % 6);
  });

  it("never discards when k is a power of two", () => {
    const next = scripted([4294967295]);

    expect(uniformIndex(next, 4)).toBe(3);
  });

  it("swaps each position with one drawn from the remaining candidates", () => {
    // n = 4, s = 2: i = 0 takes index(4) = 2 → swap 0 and 2; i = 1 takes index(3) = 2 → swap 1 and 3.
    const next = scripted([2, 5]);

    expect(sampleWithoutReplacement(["a", "b", "c", "d"], 2, next)).toEqual(["c", "d"]);
  });
});

describe("sampling without replacement", () => {
  it.each([0, 1, 2, 3, 20, 21, 50])("takes min(n, 20) distinct candidates for n = %i", (n) => {
    const sample = sampleWithoutReplacement(range(n), 20, seededUint32Source(SEED_0_TO_31));

    expect(sample).toHaveLength(Math.min(n, 20));
    expect(new Set(sample).size).toBe(sample.length);
    expect(sample.every((value) => value >= 0 && value < n)).toBe(true);
  });

  it("replays the same sample in the same order from the same seed", () => {
    const first = sampleWithoutReplacement(range(40), 20, seededUint32Source(SEED_ALL_FF));
    const second = sampleWithoutReplacement(range(40), 20, seededUint32Source(Buffer.from(SEED_ALL_FF)));

    expect(second).toEqual(first);
  });

  it("does not modify the candidate list", () => {
    const candidates = range(10);

    sampleWithoutReplacement(candidates, 5, seededUint32Source(SEED_0_TO_31));

    expect(candidates).toEqual(range(10));
  });

  it("draws a 32-byte seed from the system source", () => {
    const seed = systemSeedSource();

    expect(seed).toHaveLength(SUMMARY_SEED_BYTES);
    expect(seed.toString("hex")).toMatch(/^[0-9a-f]{64}$/);
  });

  // Deterministic: the seeds are fixed, so this cannot flake. Uniformity itself follows from the unbiased index
  // and Fisher–Yates; this only guards against a gross error such as a skipped swap or a fixed position.
  it("includes every candidate at a similar rate over fixed seeds", () => {
    const n = 10;
    const size = 3;
    const runs = 2_000;
    const counts = new Array<number>(n).fill(0);
    for (let run = 0; run < runs; run += 1) {
      const seed = Buffer.alloc(32);
      seed.writeUInt32BE(run);
      for (const index of sampleWithoutReplacement(range(n), size, seededUint32Source(seed))) {
        counts[index] = (counts[index] ?? 0) + 1;
      }
    }

    const expected = (runs * size) / n;
    for (const count of counts) {
      expect(Math.abs(count - expected)).toBeLessThan(expected * 0.15);
    }
  });
});
