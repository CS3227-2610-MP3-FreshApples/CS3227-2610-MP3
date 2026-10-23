import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createAdminSummaryRegenerationService,
  parseAdminSummaryRegenerationInput,
  type AdminSummaryRegenerationDependencies,
} from "../../../../src/server/services/ai/summary";
import type {
  AccountId,
  MovieId,
  MovieUpdateLock,
  RequestId,
  ReviewsRevision,
  Tx,
} from "../../../../src/server/shared";

const TX = {} as Tx;
const MOVIE_ID = "20000000-0000-4000-8000-000000000031" as MovieId;
const ADMIN_ID = "10000000-0000-4000-8000-000000000031" as AccountId;
const REQUEST_ID = "50000000-0000-4000-8000-000000000031" as RequestId;
const LOCK = { movieId: MOVIE_ID, archived: false, reviewsRevision: 4 as ReviewsRevision } as MovieUpdateLock;
const NOW = new Date("2026-10-23T01:00:00.000Z");
const TOMORROW = new Date("2026-10-24T01:00:00.000Z");

function harness(overrides: Partial<AdminSummaryRegenerationDependencies> = {}) {
  const calls: string[] = [];
  let transactionOpen = false;
  const deps: AdminSummaryRegenerationDependencies = {
    database: {
      async withTransaction(work) {
        calls.push("tx:start");
        transactionOpen = true;
        try {
          const value = await work(TX);
          calls.push("tx:commit");
          return value;
        } finally {
          transactionOpen = false;
        }
      },
      async withTransactionResult(work) {
        calls.push("tx:start");
        transactionOpen = true;
        try {
          const result = await work(TX);
          calls.push(result.ok ? "tx:commit" : "tx:rollback");
          return result;
        } finally {
          transactionOpen = false;
        }
      },
    },
    rateLimiter: { consume: vi.fn(async () => ({ allowed: true as const })) },
    rateLimitKeys: { forAccount: vi.fn(() => "summary_regeneration:account:synthetic" as never) },
    movieLocks: {
      lockActiveMovieForUpdate: vi.fn(async () => {
        calls.push("lock");
        return { ok: true as const, value: LOCK };
      }),
    },
    marker: {
      markReviewsChanged: vi.fn(async () => {
        calls.push("invalidate");
        return 5 as ReviewsRevision;
      }),
    },
    clock: {
      readScheduleClock: vi.fn(async () => {
        calls.push("clock");
        return { now: NOW, oneDayLater: TOMORROW };
      }),
    },
    schedule: {
      recordSummaryAttempt: vi.fn(async (_tx, _movie, at) => {
        calls.push(`schedule:${at.toISOString()}`);
      }),
    },
    auditLog: { record: vi.fn(async () => { calls.push("audit"); }) },
    generation: {
      generateForAdmin: vi.fn(async () => {
        calls.push(`generate:tx=${transactionOpen}`);
        return { kind: "published" as const, jobId: "40000000-0000-4000-8000-000000000031" as never };
      }),
    },
    log: { record: vi.fn() },
    ...overrides,
  };
  return { deps, service: createAdminSummaryRegenerationService(deps), calls };
}

const ADMIN = { accountId: ADMIN_ID, role: "ADMIN" as const };

describe("Admin summary regeneration service", () => {
  it("rate-limits before the atomic invalidation and generates only after commit", async () => {
    const h = harness();
    await expect(h.service.regenerate(MOVIE_ID, ADMIN, REQUEST_ID)).resolves.toEqual({
      ok: true,
      value: { status: "generated" },
    });
    expect(h.deps.rateLimiter.consume).toHaveBeenCalledWith(
      "summary_regeneration:account:synthetic",
      { limit: 1, windowSeconds: 300 },
      1,
    );
    expect(h.calls).toEqual([
      "tx:start",
      "lock",
      "invalidate",
      "clock",
      `schedule:${TOMORROW.toISOString()}`,
      "audit",
      "tx:commit",
      "generate:tx=false",
    ]);
    expect(h.deps.auditLog.record).toHaveBeenCalledWith(TX, {
      actorId: ADMIN_ID,
      action: "movie.summary_regenerate",
      targetType: "movie",
      targetId: MOVIE_ID,
      result: "applied",
      metadata: { newReviewsRevision: 5 },
      requestId: REQUEST_ID,
    });
  });

  it("rejects a non-Admin in the service before throttle or writes", async () => {
    const h = harness();
    await expect(h.service.regenerate(MOVIE_ID, { accountId: ADMIN_ID, role: "USER" }, REQUEST_ID)).resolves.toEqual({
      ok: false,
      error: { kind: "forbidden" },
    });
    expect(h.deps.rateLimiter.consume).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it("returns the rate-limit rejection without Movie, audit, or provider work", async () => {
    const h = harness({ rateLimiter: { consume: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 247 })) } });
    await expect(h.service.regenerate(MOVIE_ID, ADMIN, REQUEST_ID)).resolves.toEqual({
      ok: false,
      error: { kind: "rate_limited", retryAfterSeconds: 247 },
    });
    expect(h.calls).toEqual([]);
    expect(h.deps.generation?.generateForAdmin).not.toHaveBeenCalled();
  });

  it.each(["not_found", "archived"] as const)("maps a %s Movie to not_found and rolls back", async (kind) => {
    const h = harness({
      movieLocks: { lockActiveMovieForUpdate: vi.fn(async () => ({ ok: false as const, error: { kind } })) },
    });
    await expect(h.service.regenerate(MOVIE_ID, ADMIN, REQUEST_ID)).resolves.toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(h.calls).toEqual(["tx:start", "tx:rollback"]);
    expect(h.deps.marker.markReviewsChanged).not.toHaveBeenCalled();
  });

  it("returns insufficient_reviews after committing invalidation and makes no provider job itself", async () => {
    const h = harness({
      generation: {
        generateForAdmin: vi.fn(async () => ({ kind: "insufficient_reviews" as const, eligibleCount: 2 })),
      },
    });
    await expect(h.service.regenerate(MOVIE_ID, ADMIN, REQUEST_ID)).resolves.toEqual({
      ok: true,
      value: { status: "insufficient_reviews" },
    });
    expect(h.calls).toContain("tx:commit");
  });

  it.each(["disabled", "deferred", "duplicate"] as const)(
    "returns pending and resets the one-day backoff with the DB clock for %s",
    async (kind) => {
      const outcome = kind === "deferred"
        ? { kind, retryAfterSeconds: 30 }
        : kind === "duplicate"
          ? { kind, jobId: "40000000-0000-4000-8000-000000000031" as never }
          : { kind };
      const h = harness({ generation: { generateForAdmin: vi.fn(async () => outcome) } });
      await expect(h.service.regenerate(MOVIE_ID, ADMIN, REQUEST_ID)).resolves.toEqual({
        ok: true,
        value: { status: "pending" },
      });
      expect(h.calls).toContain(`schedule:${TOMORROW.toISOString()}`);
      expect(h.calls).toContain(`schedule:${NOW.toISOString()}`);
    },
  );

  it("keeps the committed one-day backoff and safely returns pending when generation throws", async () => {
    const h = harness({
      generation: { generateForAdmin: vi.fn(async () => { throw new Error("provider detail must not escape"); }) },
    });
    await expect(h.service.regenerate(MOVIE_ID, ADMIN, REQUEST_ID)).resolves.toEqual({
      ok: true,
      value: { status: "pending" },
    });
    expect(h.calls).not.toContain(`schedule:${NOW.toISOString()}`);
    expect(h.deps.log.record).toHaveBeenCalledWith({
      event: "summary.admin_regeneration_fault",
      requestId: REQUEST_ID,
      movieId: MOVIE_ID,
      actorId: ADMIN_ID,
      phase: "generation",
    });
  });

  it("still commits durable pending work when AI generation is unavailable", async () => {
    const h = harness({ generation: null });
    await expect(h.service.regenerate(MOVIE_ID, ADMIN, REQUEST_ID)).resolves.toEqual({
      ok: true,
      value: { status: "pending" },
    });
    expect(h.calls).toContain("invalidate");
    expect(h.calls).toContain(`schedule:${NOW.toISOString()}`);
  });
});

describe("Admin summary regeneration input", () => {
  it("accepts exactly an empty object", () => {
    expect(parseAdminSummaryRegenerationInput({})).toEqual({ ok: true, value: {} });
  });

  it.each([null, [], "", 1])("rejects non-object input %o", (input) => {
    expect(parseAdminSummaryRegenerationInput(input)).toEqual({ ok: false, error: { body: ["must be an object"] } });
  });

  it("rejects every unknown field", () => {
    expect(parseAdminSummaryRegenerationInput({ force: true, requesterId: ADMIN_ID })).toEqual({
      ok: false,
      error: { force: ["is not allowed"], requesterId: ["is not allowed"] },
    });
  });
});
