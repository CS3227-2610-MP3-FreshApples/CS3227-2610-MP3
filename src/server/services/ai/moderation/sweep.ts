import "server-only";

import type { Database } from "../../../db";
import type { DueModerationWork, ModerationReviewReadRepository } from "../../../repositories/ai";
import type { RequestId, Result, ReviewId } from "../../../shared";
import type { SchedulerLeases } from "../runtime";
import type { ModerationRecovery, ScreeningAttempt } from "./types";

/** The DEP-10 cron response: integers summing to at most `AI_MODERATION_RECOVERY_MAX_REVIEWS`. */
export interface ModerationSweepCounts {
  readonly processed: number;
  readonly skipped: number;
  readonly deferred: number;
  readonly failed: number;
}

/** A fault in one of these phases makes the sweep `unavailable`, and the route returns 503 (D-101, as D-94 M8). */
export type ModerationSweepPhase = "lease" | "selection";

export type ModerationSweepUnavailable = { readonly kind: "unavailable" };

/** One line per authorized sweep (D-101). IDs, counts and results only: never text, output or errors. */
export type ModerationSweepLogLine = {
  readonly requestId: RequestId;
  readonly counts: ModerationSweepCounts;
  readonly reviewId: ReviewId | null;
  readonly result: ScreeningAttempt | null;
} & (
  | { readonly outcome: "completed" | "lease_held" | "disabled" }
  | { readonly outcome: "unavailable"; readonly phase: ModerationSweepPhase }
);

export interface ModerationSweepLog {
  record(line: ModerationSweepLogLine): void;
}

export interface ModerationSweep {
  /** Call it with no Tx open. Awaits all work before returning; nothing is detached (AI-02). */
  run(requestId: RequestId): Promise<Result<ModerationSweepCounts, ModerationSweepUnavailable>>;
}

/** `review_moderation.sweep` JSON lines on the console, `console.warn` for `unavailable`. Never throws. */
export function createConsoleModerationSweepLog(): ModerationSweepLog {
  return {
    record(line) {
      try {
        const text = JSON.stringify({ event: "review_moderation.sweep", ...line });
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

const ZERO_COUNTS: ModerationSweepCounts = Object.freeze({ processed: 0, skipped: 0, deferred: 0, failed: 0 });

/** Used without AI, the real K10 controller or under D-56: zero counts and no writes (D-101). */
export function createDisabledModerationSweep(deps: { readonly log: ModerationSweepLog }): ModerationSweep {
  return {
    async run(requestId) {
      deps.log.record({ requestId, outcome: "disabled", counts: ZERO_COUNTS, reviewId: null, result: null });
      return { ok: true, value: ZERO_COUNTS };
    },
  };
}

/** The D-101 count for each result. Exhaustive: a new result fails type-checking here. */
function countFor(result: ScreeningAttempt): keyof ModerationSweepCounts {
  switch (result) {
    case "cleared":
    case "flagged":
      return "processed";
    case "not_current":
      return "skipped";
    case "deferred":
      return "deferred";
    case "manual_review":
      return "failed";
  }
}

class SweepPhaseFault extends Error {
  constructor(readonly phase: ModerationSweepPhase) {
    super(`review moderation sweep ${phase} fault`);
    this.name = "SweepPhaseFault";
  }
}

interface AttemptResult {
  readonly reviewId: ReviewId;
  readonly result: ScreeningAttempt;
}

/**
 * The DEP-10 recovery sweep (D-101) inside the `review_moderation_sweep` lease. Selection runs in its own short
 * Tx; each item goes through `attemptFromSweep` with no Tx open, which re-verifies it under the locks (D-58).
 */
export function createModerationSweep(deps: {
  readonly database: Database;
  readonly leases: SchedulerLeases;
  readonly selection: Pick<ModerationReviewReadRepository, "selectDue">;
  readonly recovery: ModerationRecovery;
  /** `AI_MODERATION_RECOVERY_MAX_REVIEWS`. */
  readonly limits: { readonly maxReviews: number };
  readonly log: ModerationSweepLog;
}): ModerationSweep {
  async function selectDue(): Promise<readonly DueModerationWork[]> {
    try {
      return await deps.database.withTransaction((tx) => deps.selection.selectDue(tx, deps.limits.maxReviews));
    } catch {
      throw new SweepPhaseFault("selection");
    }
  }

  function sweep(requestId: RequestId) {
    return async (): Promise<readonly AttemptResult[]> => {
      const results: AttemptResult[] = [];
      for (const { reviewId, contentRevision } of await selectDue()) {
        // Never throws: a fault inside the attempt gives `deferred` (D-101).
        results.push({ reviewId, result: await deps.recovery.attemptFromSweep(reviewId, contentRevision, requestId) });
      }
      return results;
    };
  }

  return {
    async run(requestId) {
      let leased: { readonly acquired: false } | { readonly acquired: true; readonly value: readonly AttemptResult[] };
      try {
        leased = await deps.leases.withSweepLease("review_moderation_sweep", sweep(requestId));
      } catch (error) {
        // A throw that is not a selection fault comes from acquiring or releasing the lease.
        const phase = error instanceof SweepPhaseFault ? error.phase : "lease";
        deps.log.record({ requestId, outcome: "unavailable", phase, counts: ZERO_COUNTS, reviewId: null, result: null });
        return { ok: false, error: { kind: "unavailable" } };
      }
      if (!leased.acquired) {
        deps.log.record({ requestId, outcome: "lease_held", counts: ZERO_COUNTS, reviewId: null, result: null });
        return { ok: true, value: ZERO_COUNTS };
      }
      const counts = { processed: 0, skipped: 0, deferred: 0, failed: 0 };
      for (const { result } of leased.value) {
        counts[countFor(result)] += 1;
      }
      // At most `AI_MODERATION_RECOVERY_MAX_REVIEWS` (1) Review, so the line names the last attempt.
      const last = leased.value.at(-1);
      deps.log.record({
        requestId,
        outcome: "completed",
        counts,
        reviewId: last?.reviewId ?? null,
        result: last?.result ?? null,
      });
      return { ok: true, value: counts };
    },
  };
}
