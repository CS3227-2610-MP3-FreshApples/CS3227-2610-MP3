import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { Database } from "../../../../src/server/db";
import type { DueModerationWork } from "../../../../src/server/repositories/ai";
import {
  createConsoleModerationSweepLog,
  createDisabledModerationSweep,
  createModerationSweep,
  type ModerationSweepLogLine,
  type ScreeningAttempt,
} from "../../../../src/server/services/ai/moderation";
import type { SchedulerLeases } from "../../../../src/server/services/ai/runtime";
import type { ContentRevision, RequestId, ReviewId, Tx } from "../../../../src/server/shared";

// The D-101 sweep with fakes. PostgreSQL behaviour is in tests/integration/ai/moderation/.

const REVIEW_ID = "30000000-0000-4000-8000-000000000201" as ReviewId;
const REQUEST_ID = "50000000-0000-4000-8000-000000000201" as RequestId;
const DUE: DueModerationWork = { reviewId: REVIEW_ID, contentRevision: 2 as ContentRevision };

interface Harness {
  readonly logs: ModerationSweepLogLine[];
  readonly attempts: [ReviewId, ContentRevision, RequestId][];
  readonly limits: number[];
  readonly txOpenDuringAttempt: boolean[];
  run(): ReturnType<ReturnType<typeof createModerationSweep>["run"]>;
}

function harness(
  options: {
    readonly due?: readonly DueModerationWork[];
    readonly result?: ScreeningAttempt;
    readonly leaseHeld?: boolean;
    readonly leaseThrows?: boolean;
    readonly selectionThrows?: boolean;
  } = {},
): Harness {
  const logs: ModerationSweepLogLine[] = [];
  const attempts: [ReviewId, ContentRevision, RequestId][] = [];
  const limits: number[] = [];
  const txOpenDuringAttempt: boolean[] = [];
  let txOpen = false;
  const database = {
    async withTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
      txOpen = true;
      try {
        return await work({} as Tx);
      } finally {
        txOpen = false;
      }
    },
  } as unknown as Database;
  const leases: SchedulerLeases = {
    async withSweepLease(name, work) {
      expect(name).toBe("review_moderation_sweep");
      if (options.leaseThrows === true) throw new Error("lease fault");
      if (options.leaseHeld === true) return { acquired: false };
      return { acquired: true, value: await work() };
    },
  };
  const sweep = createModerationSweep({
    database,
    leases,
    selection: {
      async selectDue(_tx, limit) {
        limits.push(limit);
        if (options.selectionThrows === true) throw new Error("selection fault");
        return options.due ?? [DUE];
      },
    },
    recovery: {
      async attemptFromSweep(reviewId, contentRevision, requestId) {
        txOpenDuringAttempt.push(txOpen);
        attempts.push([reviewId, contentRevision, requestId]);
        return options.result ?? "cleared";
      },
    },
    limits: { maxReviews: 1 },
    log: { record: (line) => logs.push(line) },
  });
  return { logs, attempts, limits, txOpenDuringAttempt, run: () => sweep.run(REQUEST_ID) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("counts (D-101)", () => {
  it.each<[ScreeningAttempt, string]>([
    ["cleared", "processed"],
    ["flagged", "processed"],
    ["not_current", "skipped"],
    ["deferred", "deferred"],
    ["manual_review", "failed"],
  ])("counts %s as %s", async (result, count) => {
    const h = harness({ result });

    const swept = await h.run();

    expect(swept).toEqual({ ok: true, value: { processed: 0, skipped: 0, deferred: 0, failed: 0, [count]: 1 } });
    expect(h.logs).toEqual([
      expect.objectContaining({ outcome: "completed", reviewId: REVIEW_ID, result, requestId: REQUEST_ID }),
    ]);
  });

  it("selects at most AI_MODERATION_RECOVERY_MAX_REVIEWS and attempts each with the sweep's request ID", async () => {
    const h = harness();

    await h.run();

    expect(h.limits).toEqual([1]);
    expect(h.attempts).toEqual([[REVIEW_ID, 2, REQUEST_ID]]);
  });

  it("holds no Tx while it attempts an item", async () => {
    const h = harness();

    await h.run();

    expect(h.txOpenDuringAttempt).toEqual([false]);
  });

  it("returns zero counts when nothing is due", async () => {
    const h = harness({ due: [] });

    expect(await h.run()).toEqual({ ok: true, value: { processed: 0, skipped: 0, deferred: 0, failed: 0 } });
    expect(h.logs).toEqual([expect.objectContaining({ outcome: "completed", reviewId: null, result: null })]);
  });
});

describe("lease and faults (D-101, as D-94 M8)", () => {
  it("skips an overlapping run while the lease is held", async () => {
    const h = harness({ leaseHeld: true });

    expect(await h.run()).toEqual({ ok: true, value: { processed: 0, skipped: 0, deferred: 0, failed: 0 } });
    expect(h.attempts).toEqual([]);
    expect(h.logs).toEqual([expect.objectContaining({ outcome: "lease_held" })]);
  });

  it("is unavailable when the lease cannot be taken", async () => {
    const h = harness({ leaseThrows: true });

    expect(await h.run()).toEqual({ ok: false, error: { kind: "unavailable" } });
    expect(h.logs).toEqual([expect.objectContaining({ outcome: "unavailable", phase: "lease" })]);
  });

  it("is unavailable when selection fails, and attempts nothing", async () => {
    const h = harness({ selectionThrows: true });

    expect(await h.run()).toEqual({ ok: false, error: { kind: "unavailable" } });
    expect(h.attempts).toEqual([]);
    expect(h.logs).toEqual([expect.objectContaining({ outcome: "unavailable", phase: "selection" })]);
  });
});

describe("disabled sweep and log", () => {
  it("returns zero counts and logs disabled", async () => {
    const logs: ModerationSweepLogLine[] = [];
    const sweep = createDisabledModerationSweep({ log: { record: (line) => logs.push(line) } });

    expect(await sweep.run(REQUEST_ID)).toEqual({ ok: true, value: { processed: 0, skipped: 0, deferred: 0, failed: 0 } });
    expect(logs).toEqual([expect.objectContaining({ outcome: "disabled" })]);
  });

  it("writes review_moderation.sweep lines, warning only for unavailable, and never throws", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = createConsoleModerationSweepLog();
    const counts = { processed: 0, skipped: 0, deferred: 0, failed: 0 };

    log.record({ requestId: REQUEST_ID, outcome: "completed", counts, reviewId: REVIEW_ID, result: "cleared" });
    log.record({ requestId: REQUEST_ID, outcome: "unavailable", phase: "lease", counts, reviewId: null, result: null });

    expect(JSON.parse(info.mock.calls[0]![0] as string)).toEqual({
      event: "review_moderation.sweep",
      requestId: REQUEST_ID,
      outcome: "completed",
      counts,
      reviewId: REVIEW_ID,
      result: "cleared",
    });
    expect(JSON.parse(warn.mock.calls[0]![0] as string)).toMatchObject({ outcome: "unavailable", phase: "lease" });

    info.mockImplementation(() => {
      throw new Error("console unavailable");
    });
    expect(() =>
      log.record({ requestId: REQUEST_ID, outcome: "completed", counts, reviewId: null, result: null }),
    ).not.toThrow();
  });
});
