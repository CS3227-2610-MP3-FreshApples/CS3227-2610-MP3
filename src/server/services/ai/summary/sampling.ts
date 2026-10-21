import "server-only";

import { createHash, randomBytes } from "node:crypto";

/** Recorded in `sampled_review_ids_and_versions.algorithm` (D-88). */
export const SUMMARY_SAMPLE_ALGORITHM = "summary-sample-v1";

export const SUMMARY_SEED_BYTES = 32;

/** Draws a fresh seed for each generation attempt; a constructor dependency so tests can fix it (D-86). */
export type SummarySeedSource = () => Buffer;

export const systemSeedSource: SummarySeedSource = () => randomBytes(SUMMARY_SEED_BYTES);

/** Unsigned 32-bit values, used in order. */
export type Uint32Source = () => number;

const UINT32_RANGE = 2 ** 32;
const VALUES_PER_DIGEST = 8;

/** SHA-256 of the seed bytes and a 4-byte big-endian counter from 0; each digest gives eight big-endian values. */
export function seededUint32Source(seed: Buffer): Uint32Source {
  let counter = 0;
  let digest = Buffer.alloc(0);
  let offset = VALUES_PER_DIGEST;
  return () => {
    if (offset === VALUES_PER_DIGEST) {
      const counterBytes = Buffer.alloc(4);
      counterBytes.writeUInt32BE(counter);
      counter += 1;
      digest = createHash("sha256").update(seed).update(counterBytes).digest();
      offset = 0;
    }
    const value = digest.readUInt32BE(offset * 4);
    offset += 1;
    return value;
  };
}

/** A uniform index in [0, k): values of at least floor(2^32 / k) × k are discarded, so modulo has no bias. */
export function uniformIndex(next: Uint32Source, k: number): number {
  const limit = Math.floor(UINT32_RANGE / k) * k;
  for (;;) {
    const value = next();
    if (value < limit) {
      return value % k;
    }
  }
}

/**
 * Partial Fisher–Yates: for i from 0 to s − 1, swap position i with position i + index(n − i). Returns the first
 * `s = min(n, size)` candidates in that order, which is a uniform sample without replacement.
 */
export function sampleWithoutReplacement<T>(candidates: readonly T[], size: number, next: Uint32Source): T[] {
  const pool = [...candidates];
  const s = Math.min(pool.length, size);
  for (let i = 0; i < s; i += 1) {
    const j = i + uniformIndex(next, pool.length - i);
    [pool[i], pool[j]] = [pool[j] as T, pool[i] as T];
  }
  return pool.slice(0, s);
}
