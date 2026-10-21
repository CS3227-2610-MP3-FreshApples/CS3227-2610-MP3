import "server-only";

import { z } from "zod";

import type { Database } from "../../../db";
import type { PublicSummaryReadRepository, PublicSummarySnapshot, StoredCurrentSummary } from "../../../repositories/summary";
import type { MovieId } from "../../../shared";
import { MIN_SUMMARY_REVIEWS } from "./input-preparation";
import { validateSummaryOutput, type SummaryOutput, type SummaryOutputItem } from "./output-schema";
import { SUMMARY_PROMPT_VERSION } from "./prompt";
import { SUMMARY_SAMPLE_ALGORITHM } from "./sampling";

/** One public list item: the text only, never its source labels (D-90). */
export interface PublicSummaryItem {
  readonly text: string;
}

/** The D-90 `summary` object, present only when `status` is `ready`. */
export interface PublicSummary {
  readonly overall: string;
  readonly strengths: readonly PublicSummaryItem[];
  readonly criticisms: readonly PublicSummaryItem[];
  readonly mixedOpinions: readonly PublicSummaryItem[];
  readonly includedCount: number;
  readonly truncated: boolean;
  /** ISO 8601 UTC. */
  readonly generatedAt: string;
}

/** The api.md / D-90 response for GET /movies/:id/summary. */
export type PublicSummaryView =
  | { readonly status: "ready"; readonly eligibleCount: number; readonly summary: PublicSummary }
  | { readonly status: "missing" | "stale" | "insufficient_reviews"; readonly eligibleCount: number };

export interface PublicSummaryReadLog {
  /** A stored row failed validation and was skipped (D-94 L7, D-98). IDs only. */
  invalidStoredOutput(movieId: MovieId, summaryId: string): void;
}

export interface PublicSummaryReadService {
  /** One statement in its own short Tx. Returns null for a missing or archived Movie. Never calls K10 or writes. */
  getSummary(movieId: MovieId): Promise<PublicSummaryView | null>;
}

/** `summary.read.invalid_stored_output` JSON lines on `console.warn`. Never throws. */
export function createConsolePublicSummaryReadLog(): PublicSummaryReadLog {
  return {
    invalidStoredOutput(movieId, summaryId) {
      try {
        console.warn(JSON.stringify({ event: "summary.read.invalid_stored_output", movieId, summaryId }));
      } catch {
        // A log line must never fail the read.
      }
    },
  };
}

const MAX_SAMPLE_SIZE = 20;

// The stored D-88 sample, strict at both levels (D-98).
const storedSampleSchema = z
  .strictObject({
    algorithm: z.literal(SUMMARY_SAMPLE_ALGORITHM),
    seed: z.string().regex(/^[0-9a-f]{64}$/),
    sampledCount: z.number().int().min(MIN_SUMMARY_REVIEWS).max(MAX_SAMPLE_SIZE),
    reviews: z
      .array(
        z.strictObject({
          reviewId: z.guid(),
          version: z.number().int().min(1),
          contentRevision: z.number().int().min(1),
          truncated: z.boolean(),
        }),
      )
      .min(MIN_SUMMARY_REVIEWS),
  })
  .refine((sample) => sample.reviews.length <= sample.sampledCount);

type StoredSample = z.infer<typeof storedSampleSchema>;

/** Validates one stored row: its sample, then its output against the sample's labels `R1`–`Rn` (D-98). */
function validStoredSummary(row: StoredCurrentSummary): { output: SummaryOutput; sample: StoredSample } | null {
  const sample = storedSampleSchema.safeParse(row.sample);
  if (!sample.success) {
    return null;
  }
  const labels = sample.data.reviews.map((_, index) => `R${index + 1}`);
  const output = validateSummaryOutput(row.output, labels);
  return output.ok ? { output: output.value, sample: sample.data } : null;
}

// Built field by field, so sources and any other stored key never reach the response (D-90).
function publicItems(items: readonly SummaryOutputItem[]): PublicSummaryItem[] {
  return items.map(({ text }) => ({ text }));
}

/**
 * The D-90 precedence (as amended by D-93, D-94 and D-98) over one snapshot of an active Movie. Pure apart from
 * `log`, which hears of each invalid current row skipped.
 */
export function projectPublicSummary(
  movieId: MovieId,
  snapshot: PublicSummarySnapshot,
  log: PublicSummaryReadLog,
): PublicSummaryView {
  const { eligibleCount } = snapshot;
  if (eligibleCount < MIN_SUMMARY_REVIEWS) {
    return { status: "insufficient_reviews", eligibleCount };
  }
  for (const row of snapshot.currentSummaries) {
    const valid = validStoredSummary(row);
    if (valid === null) {
      log.invalidStoredOutput(movieId, row.id);
      continue;
    }
    const { output, sample } = valid;
    return {
      status: "ready",
      eligibleCount,
      summary: {
        overall: output.overall,
        strengths: publicItems(output.strengths),
        criticisms: publicItems(output.criticisms),
        mixedOpinions: publicItems(output.mixedOpinions),
        includedCount: sample.reviews.length,
        truncated: sample.reviews.some((review) => review.truncated),
        generatedAt: row.generatedAt,
      },
    };
  }
  return { status: snapshot.hasAnySummary ? "stale" : "missing", eligibleCount };
}

export function createPublicSummaryReadService(deps: {
  readonly database: Database;
  readonly summaries: PublicSummaryReadRepository;
  readonly log: PublicSummaryReadLog;
}): PublicSummaryReadService {
  return {
    async getSummary(movieId) {
      const snapshot = await deps.database.withTransaction((tx) =>
        deps.summaries.readSnapshot(tx, movieId, SUMMARY_PROMPT_VERSION),
      );
      return snapshot === null ? null : projectPublicSummary(movieId, snapshot, deps.log);
    },
  };
}
