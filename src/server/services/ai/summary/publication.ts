import "server-only";

import type { ReviewSummaryRepository } from "../../../repositories/summary";
import type { AiJobId, MovieId, Result, ReviewsRevision, Tx } from "../../../shared";
import type { MovieLocks, SummarySchedule, SummaryStale } from "../../catalogue";
import type { SummarySample } from "./input-preparation";
import type { SummaryOutput } from "./output-schema";
import { SUMMARY_PROMPT_VERSION } from "./prompt";

/** What one generation captured from its D-86 snapshot, to publish with the validated output. */
export interface SummaryPublication {
  readonly movieId: MovieId;
  /** The revision the sample was read at. */
  readonly reviewsRevision: ReviewsRevision;
  readonly eligibleCount: number;
  readonly sample: SummarySample;
}

export interface SummaryPublisher {
  /**
   * The K10 `publish` callback body (contracts §3.3, AM-23, AM-25), inside K10's publish Tx. Returns `stale`, and
   * K10 rolls back every write, when the Movie is missing or archived, its revision has moved, a current summary
   * already exists, or K7 rejects the publication.
   */
  publish(
    tx: Tx,
    publication: SummaryPublication,
    output: SummaryOutput,
    /** The running AIJob K10 publishes for (D-96: the ID only, not K10's `AiJobRef`). */
    jobId: AiJobId,
  ): Promise<Result<void, SummaryStale>>;
}

const STALE: Result<never, SummaryStale> = Object.freeze({ ok: false, error: Object.freeze({ kind: "stale" }) });

export function createSummaryPublisher(deps: {
  readonly movieLocks: MovieLocks;
  readonly schedule: SummarySchedule;
  readonly summaries: ReviewSummaryRepository;
}): SummaryPublisher {
  return {
    async publish(tx, publication, output, jobId) {
      const { movieId, reviewsRevision } = publication;
      const movie = await deps.movieLocks.lockActiveMovieForUpdate(tx, movieId);
      if (!movie.ok || movie.value.reviewsRevision !== reviewsRevision) {
        return STALE;
      }
      // D-93: the Movie lock serializes publishers, so this check needs no constraint or extra lock.
      if (await deps.summaries.existsCurrent(tx, movieId, reviewsRevision, SUMMARY_PROMPT_VERSION)) {
        return STALE;
      }
      await deps.summaries.insert(tx, {
        jobId,
        movieId,
        reviewsRevision,
        sampleJson: JSON.stringify(publication.sample),
        eligibleCount: publication.eligibleCount,
        outputJson: JSON.stringify(output),
      });
      return deps.schedule.recordSummaryPublished(tx, movie.value, reviewsRevision);
    },
  };
}
