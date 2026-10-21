import "server-only";

import type { Database } from "../../../db";
import type { SummarySelectionRepository } from "../../../repositories/summary";
import type { AiJobId, MovieId, RequestId, Result } from "../../../shared";
import type { MovieLocks, SummarySchedule } from "../../catalogue";
import type { SchedulerLeases } from "../runtime";
import type { SummaryGeneration, SummaryGenerationOutcome } from "./generation";
import { SUMMARY_PROMPT_VERSION } from "./prompt";

/** The D-89 cron response: integers summing to at most `AI_SUMMARY_MAX_MOVIES_PER_RUN`. */
export interface SummarySweepCounts {
  readonly processed: number;
  readonly skipped: number;
  readonly deferred: number;
  readonly failed: number;
}

/** A fault in one of these phases makes the sweep `unavailable`, and the route returns 503 (D-94 M8, D-98). */
export type SummarySweepPhase = "lease" | "selection" | "attempt";

export type SummarySweepUnavailable = { readonly kind: "unavailable" };

/** One line per authorized sweep (D-94 L8, D-98). IDs, counts and kinds only: never text, output or errors. */
export type SummarySweepLogLine = {
  readonly requestId: RequestId;
  readonly counts: SummarySweepCounts;
  readonly movieId: MovieId | null;
  readonly outcomeKind: SummaryGenerationOutcome["kind"] | null;
  readonly jobId: AiJobId | null;
} & (
  | { readonly outcome: "completed" | "lease_held" | "disabled" }
  | { readonly outcome: "unavailable"; readonly phase: SummarySweepPhase }
);

export interface SummarySweepLog {
  record(line: SummarySweepLogLine): void;
}

export interface SummarySweep {
  /** Call it with no Tx open. Awaits all work before returning; nothing is detached (DEP-09). */
  run(requestId: RequestId): Promise<Result<SummarySweepCounts, SummarySweepUnavailable>>;
}

/** `summary.sweep` JSON lines on the console, `console.warn` for `unavailable`. Never throws. */
export function createConsoleSummarySweepLog(): SummarySweepLog {
  return {
    record(line) {
      try {
        const text = JSON.stringify({ event: "summary.sweep", ...line });
        if (line.outcome === "unavailable") {
          console.warn(text);
        } else {
          console.info(text);
        }
      } catch {
        // A log line must never fail the sweep.
      }
    },
  };
}

const ZERO_COUNTS: SummarySweepCounts = Object.freeze({ processed: 0, skipped: 0, deferred: 0, failed: 0 });

/** Used when AI or the scheduler leases are unavailable: zero counts and no writes (D-89, D-93). */
export function createDisabledSummarySweep(deps: { readonly log: SummarySweepLog }): SummarySweep {
  return {
    async run(requestId) {
      deps.log.record({ requestId, outcome: "disabled", counts: ZERO_COUNTS, movieId: null, outcomeKind: null, jobId: null });
      return { ok: true, value: ZERO_COUNTS };
    },
  };
}

type Count = keyof SummarySweepCounts;

/** Step 1 keeps the 1-day backoff; step 2 resets the next attempt to now (D-89). */
type ScheduleAfter = "step1" | "step2";

/** The D-89 outcome mapping. Exhaustive: a new outcome kind fails type-checking here. */
function classify(kind: SummaryGenerationOutcome["kind"]): { readonly count: Count; readonly after: ScheduleAfter } {
  switch (kind) {
    case "published":
      return { count: "processed", after: "step1" };
    case "current":
    case "insufficient_reviews":
    case "unavailable":
      return { count: "skipped", after: "step1" };
    case "duplicate":
      return { count: "skipped", after: "step2" };
    case "deferred":
    case "disabled":
      return { count: "deferred", after: "step2" };
    case "input_unfit":
    case "input_too_large":
    case "failed":
    case "stale":
      return { count: "failed", after: "step1" };
  }
}

function jobIdOf(outcome: SummaryGenerationOutcome): AiJobId | null {
  return "jobId" in outcome ? outcome.jobId : null;
}

class SweepPhaseFault extends Error {
  constructor(readonly phase: SummarySweepPhase) {
    super(`summary sweep ${phase} fault`);
    this.name = "SweepPhaseFault";
  }
}

/** Runs `work`, turning any throw into a fault of `phase` so the sweep can report it without the error text. */
async function inPhase<T>(phase: SummarySweepPhase, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw new SweepPhaseFault(phase);
  }
}

interface AttemptResult {
  readonly movieId: MovieId;
  readonly count: Count;
  readonly outcomeKind: SummaryGenerationOutcome["kind"] | null;
  readonly jobId: AiJobId | null;
}

/**
 * The D-89 sweep as amended by D-94 and D-98, inside the `summary_sweep` lease. Selection, step 1 and step 2 each
 * run in their own short Tx; generation runs with none open.
 */
export function createSummarySweep(deps: {
  readonly database: Database;
  readonly leases: SchedulerLeases;
  readonly selection: SummarySelectionRepository;
  readonly movieLocks: Pick<MovieLocks, "lockActiveMovieForUpdate">;
  readonly schedule: Pick<SummarySchedule, "recordSummaryAttempt">;
  readonly generation: SummaryGeneration;
  /** `AI_SUMMARY_INTERVAL_DAYS` and `AI_SUMMARY_MAX_MOVIES_PER_RUN`. */
  readonly limits: { readonly intervalDays: number; readonly maxMoviesPerRun: number };
  readonly log: SummarySweepLog;
}): SummarySweep {
  const { database } = deps;

  /** Step 1: records the attempt with the 1-day backoff before generating. False when the Movie is not active. */
  function recordAttempt(movieId: MovieId): Promise<boolean> {
    return database.withTransaction(async (tx) => {
      const movie = await deps.movieLocks.lockActiveMovieForUpdate(tx, movieId);
      if (!movie.ok) {
        return false;
      }
      const clock = await deps.selection.readScheduleClock(tx);
      await deps.schedule.recordSummaryAttempt(tx, movie.value, clock.oneDayLater);
      return true;
    });
  }

  /** Step 2: after a capacity outcome the Movie is retried from now, behind the others. Archived: no write. */
  async function releaseBackoff(movieId: MovieId): Promise<void> {
    await database.withTransaction(async (tx) => {
      const movie = await deps.movieLocks.lockActiveMovieForUpdate(tx, movieId);
      if (!movie.ok) {
        return;
      }
      const clock = await deps.selection.readScheduleClock(tx);
      await deps.schedule.recordSummaryAttempt(tx, movie.value, clock.now);
    });
  }

  async function attempt(movieId: MovieId): Promise<AttemptResult> {
    if (!(await inPhase("attempt", () => recordAttempt(movieId)))) {
      return { movieId, count: "skipped", outcomeKind: null, jobId: null };
    }
    let outcome: SummaryGenerationOutcome;
    try {
      outcome = await deps.generation.generate(movieId);
    } catch {
      // D-94 M8: step 1's backoff stands and the sweep still reports its counts.
      return { movieId, count: "failed", outcomeKind: null, jobId: null };
    }
    const { count, after } = classify(outcome.kind);
    if (after === "step2") {
      try {
        await releaseBackoff(movieId);
      } catch {
        // D-94 M8: the Movie keeps step 1's values.
      }
    }
    return { movieId, count, outcomeKind: outcome.kind, jobId: jobIdOf(outcome) };
  }

  async function sweep(): Promise<readonly AttemptResult[]> {
    const due = await inPhase("selection", () =>
      database.withTransaction((tx) =>
        deps.selection.selectDue(tx, {
          promptVersion: SUMMARY_PROMPT_VERSION,
          intervalDays: deps.limits.intervalDays,
          limit: deps.limits.maxMoviesPerRun,
        }),
      ),
    );
    const results: AttemptResult[] = [];
    for (const movieId of due) {
      results.push(await attempt(movieId));
    }
    return results;
  }

  return {
    async run(requestId) {
      let leased: { readonly acquired: false } | { readonly acquired: true; readonly value: readonly AttemptResult[] };
      try {
        // A throw that is not already a phase fault comes from acquiring the lease.
        leased = await deps.leases.withSweepLease("summary_sweep", sweep);
      } catch (error) {
        const phase = error instanceof SweepPhaseFault ? error.phase : "lease";
        deps.log.record({ requestId, outcome: "unavailable", phase, counts: ZERO_COUNTS, movieId: null, outcomeKind: null, jobId: null });
        return { ok: false, error: { kind: "unavailable" } };
      }
      if (!leased.acquired) {
        deps.log.record({ requestId, outcome: "lease_held", counts: ZERO_COUNTS, movieId: null, outcomeKind: null, jobId: null });
        return { ok: true, value: ZERO_COUNTS };
      }
      const results = leased.value;
      const counts = { processed: 0, skipped: 0, deferred: 0, failed: 0 };
      for (const result of results) {
        counts[result.count] += 1;
      }
      // At most `AI_SUMMARY_MAX_MOVIES_PER_RUN` (1) Movie, so the line names the last attempt.
      const last = results.at(-1);
      deps.log.record({
        requestId,
        outcome: "completed",
        counts,
        movieId: last?.movieId ?? null,
        outcomeKind: last?.outcomeKind ?? null,
        jobId: last?.jobId ?? null,
      });
      return { ok: true, value: counts };
    },
  };
}
