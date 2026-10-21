import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { Database } from "../../../../src/server/db";
import type { SummarySelectionCriteria, SummarySelectionRepository } from "../../../../src/server/repositories/summary";
import type { SchedulerLeases } from "../../../../src/server/services/ai/runtime";
import {
  createConsoleSummarySweepLog,
  createDisabledSummarySweep,
  createSummarySweep,
  SUMMARY_PROMPT_VERSION,
  type SummaryGeneration,
  type SummaryGenerationOutcome,
  type SummarySweepLogLine,
} from "../../../../src/server/services/ai/summary";
import type { MovieLocks, SummarySchedule } from "../../../../src/server/services/catalogue";
import {
  TransactionConflict,
  type AiJobId,
  type MovieId,
  type MovieUpdateLock,
  type RequestId,
  type Result,
  type Tx,
} from "../../../../src/server/shared";

// The D-89 sweep with fakes (D-94, D-98). PostgreSQL behaviour is in tests/integration/ai/summary/.

const MOVIE_ID = "20000000-0000-4000-8000-000000000011" as MovieId;
const JOB_ID = "40000000-0000-4000-8000-000000000011" as AiJobId;
const REQUEST_ID = "50000000-0000-4000-8000-000000000011" as RequestId;
const NOW = new Date("2026-10-21T00:10:00.000Z");
const ONE_DAY_LATER = new Date("2026-10-22T00:10:00.000Z");
const LOCK = { movieId: MOVIE_ID } as unknown as MovieUpdateLock;

type Event =
  | "tx.begin"
  | "tx.end"
  | "select"
  | "lock"
  | "clock"
  | { readonly attempt: Date }
  | "generate";

interface Harness {
  readonly events: Event[];
  readonly logs: SummarySweepLogLine[];
  readonly criteria: SummarySelectionCriteria[];
  /** Asserted inside generation: no Tx may be open during it (D-89). */
  readonly txOpenDuringGeneration: boolean[];
  run(): ReturnType<ReturnType<typeof createSummarySweep>["run"]>;
}

function harness(options: {
  readonly due?: readonly MovieId[];
  readonly outcome?: SummaryGenerationOutcome | (() => Promise<SummaryGenerationOutcome>);
  readonly leaseHeld?: boolean;
  readonly leaseThrows?: boolean;
  /** Lock results in call order; the last repeats. */
  readonly locks?: readonly Result<MovieUpdateLock, { readonly kind: "not_found" } | { readonly kind: "archived" }>[];
  readonly selectThrows?: unknown;
  /** Throws from `recordSummaryAttempt` on this call (1-based). */
  readonly attemptThrowsOn?: number;
}): Harness {
  const events: Event[] = [];
  const logs: SummarySweepLogLine[] = [];
  const criteria: SummarySelectionCriteria[] = [];
  const txOpenDuringGeneration: boolean[] = [];
  let open = false;
  let lockCalls = 0;
  let attemptCalls = 0;

  const database = {
    async withTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
      if (open) throw new Error("nested withTransaction call inside an active transaction");
      open = true;
      events.push("tx.begin");
      try {
        return await work({} as Tx);
      } finally {
        open = false;
        events.push("tx.end");
      }
    },
  } as unknown as Database;

  const leases: SchedulerLeases = {
    async withSweepLease(name, work) {
      expect(name).toBe("summary_sweep");
      expect(open).toBe(false);
      if (options.leaseThrows === true) throw new Error("lease table unavailable");
      if (options.leaseHeld === true) return { acquired: false };
      return { acquired: true, value: await work() };
    },
  };

  const selection: SummarySelectionRepository = {
    async selectDue(_tx, given) {
      events.push("select");
      criteria.push(given);
      if (options.selectThrows !== undefined) throw options.selectThrows;
      return options.due ?? [MOVIE_ID];
    },
    async readScheduleClock() {
      events.push("clock");
      return { now: NOW, oneDayLater: ONE_DAY_LATER };
    },
  };

  const movieLocks: Pick<MovieLocks, "lockActiveMovieForUpdate"> = {
    async lockActiveMovieForUpdate() {
      events.push("lock");
      const locks = options.locks ?? [{ ok: true, value: LOCK }];
      const result = locks[Math.min(lockCalls, locks.length - 1)];
      lockCalls += 1;
      return result as Result<MovieUpdateLock, { readonly kind: "not_found" }>;
    },
  };

  const schedule: Pick<SummarySchedule, "recordSummaryAttempt"> = {
    async recordSummaryAttempt(_tx, _movie, nextAttemptAt) {
      attemptCalls += 1;
      if (options.attemptThrowsOn === attemptCalls) throw new Error("connection reset");
      events.push({ attempt: nextAttemptAt });
    },
  };

  const generation: SummaryGeneration = {
    async generate(movieId) {
      expect(movieId).toBe(MOVIE_ID);
      txOpenDuringGeneration.push(open);
      events.push("generate");
      const outcome = options.outcome ?? { kind: "published", jobId: JOB_ID };
      return typeof outcome === "function" ? outcome() : outcome;
    },
  };

  const sweep = createSummarySweep({
    database,
    leases,
    selection,
    movieLocks,
    schedule,
    generation,
    limits: { intervalDays: 7, maxMoviesPerRun: 1 },
    log: { record: (line) => logs.push(line) },
  });
  return { events, logs, criteria, txOpenDuringGeneration, run: () => sweep.run(REQUEST_ID) };
}

const COUNTS = (counts: Partial<Record<"processed" | "skipped" | "deferred" | "failed", number>>) => ({
  processed: 0,
  skipped: 0,
  deferred: 0,
  failed: 0,
  ...counts,
});

describe("summary sweep outcome mapping (D-89)", () => {
  it.each<[SummaryGenerationOutcome, "processed" | "skipped" | "deferred" | "failed", "step1" | "step2"]>([
    [{ kind: "published", jobId: JOB_ID }, "processed", "step1"],
    [{ kind: "current" }, "skipped", "step1"],
    [{ kind: "insufficient_reviews", eligibleCount: 2 }, "skipped", "step1"],
    [{ kind: "unavailable" }, "skipped", "step1"],
    [{ kind: "duplicate", jobId: JOB_ID }, "skipped", "step2"],
    [{ kind: "deferred", retryAfterSeconds: 30 }, "deferred", "step2"],
    [{ kind: "disabled" }, "deferred", "step2"],
    [{ kind: "input_unfit" }, "failed", "step1"],
    [{ kind: "input_too_large" }, "failed", "step1"],
    [{ kind: "failed", jobId: JOB_ID, cause: "invalid_output" }, "failed", "step1"],
    [{ kind: "stale", jobId: JOB_ID }, "failed", "step1"],
  ])("maps %o to %s with %s schedule", async (outcome, count, after) => {
    const h = harness({ outcome });

    await expect(h.run()).resolves.toEqual({ ok: true, value: COUNTS({ [count]: 1 }) });

    const attempts = h.events.filter((event): event is { attempt: Date } => typeof event === "object");
    // Step 1 always records the 1-day backoff before generating; step 2 resets it to the database now.
    expect(attempts).toEqual(after === "step1" ? [{ attempt: ONE_DAY_LATER }] : [{ attempt: ONE_DAY_LATER }, { attempt: NOW }]);
    expect(h.events.indexOf("generate")).toBeGreaterThan(h.events.findIndex((event) => typeof event === "object"));
    expect(h.txOpenDuringGeneration).toEqual([false]);
    expect(h.logs).toEqual([
      {
        requestId: REQUEST_ID,
        outcome: "completed",
        counts: COUNTS({ [count]: 1 }),
        movieId: MOVIE_ID,
        outcomeKind: outcome.kind,
        jobId: "jobId" in outcome ? JOB_ID : null,
      },
    ]);
  });

  it("selects with the summary prompt version, the configured interval and the per-run maximum", async () => {
    const h = harness({});
    await h.run();
    expect(h.criteria).toEqual([{ promptVersion: SUMMARY_PROMPT_VERSION, intervalDays: 7, limit: 1 }]);
  });

  it("runs selection, step 1 and step 2 each in its own transaction, never nested", async () => {
    const h = harness({ outcome: { kind: "deferred", retryAfterSeconds: null } });
    await h.run();
    expect(h.events).toEqual([
      "tx.begin", "select", "tx.end",
      "tx.begin", "lock", "clock", { attempt: ONE_DAY_LATER }, "tx.end",
      "generate",
      "tx.begin", "lock", "clock", { attempt: NOW }, "tx.end",
    ]);
  });
});

describe("summary sweep with nothing to do (D-89)", () => {
  it("returns zero counts and writes nothing when no Movie is due", async () => {
    const h = harness({ due: [] });
    await expect(h.run()).resolves.toEqual({ ok: true, value: COUNTS({}) });
    expect(h.events).toEqual(["tx.begin", "select", "tx.end"]);
    expect(h.logs).toMatchObject([{ outcome: "completed", movieId: null, outcomeKind: null, jobId: null }]);
  });

  it("returns zero counts without selecting when another run holds the lease", async () => {
    const h = harness({ leaseHeld: true });
    await expect(h.run()).resolves.toEqual({ ok: true, value: COUNTS({}) });
    expect(h.events).toEqual([]);
    expect(h.logs).toEqual([
      { requestId: REQUEST_ID, outcome: "lease_held", counts: COUNTS({}), movieId: null, outcomeKind: null, jobId: null },
    ]);
  });

  it("the disabled sweep returns zero counts and logs `disabled`", async () => {
    const logs: SummarySweepLogLine[] = [];
    const sweep = createDisabledSummarySweep({ log: { record: (line) => logs.push(line) } });
    await expect(sweep.run(REQUEST_ID)).resolves.toEqual({ ok: true, value: COUNTS({}) });
    expect(logs).toEqual([
      { requestId: REQUEST_ID, outcome: "disabled", counts: COUNTS({}), movieId: null, outcomeKind: null, jobId: null },
    ]);
  });
});

describe("summary sweep races and faults (D-89, D-94 M8, D-98)", () => {
  it.each([
    [{ ok: false, error: { kind: "archived" } }],
    [{ ok: false, error: { kind: "not_found" } }],
  ] as const)("counts a Movie that is no longer active at step 1 as skipped, with no write or generation (%o)", async (lock) => {
    const h = harness({ locks: [lock] });
    await expect(h.run()).resolves.toEqual({ ok: true, value: COUNTS({ skipped: 1 }) });
    expect(h.events).not.toContain("generate");
    expect(h.events.some((event) => typeof event === "object")).toBe(false);
    expect(h.logs).toMatchObject([{ outcome: "completed", movieId: MOVIE_ID, outcomeKind: null }]);
  });

  it("writes nothing at step 2 when the Movie was archived during generation", async () => {
    const h = harness({
      outcome: { kind: "deferred", retryAfterSeconds: null },
      locks: [{ ok: true, value: LOCK }, { ok: false, error: { kind: "archived" } }],
    });
    await expect(h.run()).resolves.toEqual({ ok: true, value: COUNTS({ deferred: 1 }) });
    expect(h.events.filter((event) => typeof event === "object")).toEqual([{ attempt: ONE_DAY_LATER }]);
  });

  it("counts a generation that throws after step 1 as failed and keeps step 1's backoff", async () => {
    const h = harness({ outcome: () => Promise.reject(new Error("statement timeout")) });
    await expect(h.run()).resolves.toEqual({ ok: true, value: COUNTS({ failed: 1 }) });
    expect(h.events.filter((event) => typeof event === "object")).toEqual([{ attempt: ONE_DAY_LATER }]);
    expect(h.logs).toMatchObject([{ outcome: "completed", outcomeKind: null, jobId: null }]);
  });

  it("counts the outcome as usual when step 2 throws", async () => {
    const h = harness({ outcome: { kind: "duplicate", jobId: JOB_ID }, attemptThrowsOn: 2 });
    await expect(h.run()).resolves.toEqual({ ok: true, value: COUNTS({ skipped: 1 }) });
  });

  it.each<[string, Parameters<typeof harness>[0], "lease" | "selection" | "attempt"]>([
    ["acquiring the lease throws", { leaseThrows: true }, "lease"],
    ["selection throws", { selectThrows: new Error("relation does not exist") }, "selection"],
    ["selection hits a serialization conflict", { selectThrows: new TransactionConflict() }, "selection"],
    ["step 1 throws", { attemptThrowsOn: 1 }, "attempt"],
  ])("is unavailable, with no counts, when %s", async (_label, options, phase) => {
    const h = harness(options);
    await expect(h.run()).resolves.toEqual({ ok: false, error: { kind: "unavailable" } });
    expect(h.events).not.toContain("generate");
    expect(h.logs).toEqual([
      { requestId: REQUEST_ID, outcome: "unavailable", phase, counts: COUNTS({}), movieId: null, outcomeKind: null, jobId: null },
    ]);
  });
});

describe("console summary sweep log (D-94 L8, D-98)", () => {
  it("writes one summary.sweep JSON line, warning only for unavailable", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = createConsoleSummarySweepLog();
    const base = { requestId: REQUEST_ID, counts: COUNTS({ processed: 1 }), movieId: MOVIE_ID, outcomeKind: "published", jobId: JOB_ID } as const;

    log.record({ ...base, outcome: "completed" });
    log.record({ ...base, outcome: "unavailable", phase: "selection" });

    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(info.mock.calls[0]?.[0] as string)).toEqual({ event: "summary.sweep", ...base, outcome: "completed" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toMatchObject({ event: "summary.sweep", outcome: "unavailable", phase: "selection" });
    info.mockRestore();
    warn.mockRestore();
  });
});
