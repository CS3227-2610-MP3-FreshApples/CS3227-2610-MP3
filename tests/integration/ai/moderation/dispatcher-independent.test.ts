import { randomBytes } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { LlmProvider } from "../../../../src/server/adapters/soc-llm";
import {
  createFakeLlmProvider,
  type FakeLlmOutcome,
  type FakeLlmProvider,
} from "../../../../src/server/adapters/soc-llm/fake-llm-provider";
import { createDatabase, type Database, type Sql } from "../../../../src/server/db";
import {
  createModerationJobReadRepository,
  createModerationReviewReadRepository,
  createModerationWorkRepository,
  createReviewModerationRepository,
} from "../../../../src/server/repositories/ai";
import { createReviewRepository } from "../../../../src/server/repositories/reviews";
import {
  createModerationDispatcher,
  createModerationJobReadService,
  createModerationSweep,
  createModerationWorkQueue,
  PROFANITY_POLICY_VERSION,
  REVIEW_SCREENING_PROMPT_VERSION,
  type ModerationDispatcher,
  type ModerationRecovery,
  type ModerationSettings,
} from "../../../../src/server/services/ai/moderation";
import {
  createAiExecutionController,
  createSchedulerLeases,
  type AiExecutionController,
  type AiExecutionLimits,
  type AiExecutionOutcome,
} from "../../../../src/server/services/ai/runtime";
import { createAuditLog } from "../../../../src/server/services/audit";
import { createMovieLocks, createReviewsChangedMarker } from "../../../../src/server/services/catalogue";
import { createRateLimiter, createRateLimitKeys } from "../../../../src/server/services/rate-limit";
import { createReviewLocksAndReads, createReviewTransitions } from "../../../../src/server/services/reviews";
import type { AiJobId, ContentRevision, RequestId, ReviewId } from "../../../../src/server/shared";
import { createLoginRole, dropLoginRole } from "../../../setup/test-database.mjs";
import { createManualTime } from "../../../support/fakes/manual-time";
import { instrumentDatabase } from "../../../support/instrumented-database";
import { connectAsOwner } from "../../database/schema-fixtures";
import { testDatabaseUrl } from "../../database/test-database";
import {
  seedReview as seedReviewRow,
  seedWork as seedWorkRow,
  workRows as workRowsOf,
  type ReviewSeed,
  type SeededReview,
  type WorkRow,
  type WorkSeed,
} from "./fixtures";

// Independent A-03 cases (code-quality/test-generation agent), derived from AI-02, DEP-10, AT-21, AT-24 and
// D-49/D-54/D-58/D-77/D-101/D-102. They cover cases the implementer's dispatcher and sweep suites leave out:
// the D-101 settlement table outcome by outcome, execution-count accounting across deferral, transient,
// stale and recovery paths, hide/delete/archive races during the provider call and between sweep selection and
// claim, the claim-expiry boundary, D-49 migration of abandoned running work, and the D-102 projection of jobs
// the dispatcher really wrote. All rows are synthetic.

const RUNTIME_ROLE = `mp3_mod_indep_${randomBytes(4).toString("hex")}`;
const RUNTIME_PASSWORD = randomBytes(24).toString("hex");

const MODEL_ID = "fake-model";
const OLD_POLICY = "profanity-policy-v0";
const OLD_PROMPT = "review-screening-prompt-v0";
const REQUEST_ID = "50000000-0000-4000-8000-0000000004a1" as RequestId;
const FAKE_JOB_ID = "60000000-0000-4000-8000-0000000004a1" as AiJobId;
const CONTROLLER_LIMITS: AiExecutionLimits = {
  maxAttempts: 2,
  attemptTimeoutMs: 30_000,
  executionDeadlineMs: 75_000,
  inputTokenLimit: 8_000,
  requestsPerMinute: 1_000,
  dailyBudgetMicrodollars: 50_000_000,
  prices: { inputMicrodollarsPerMTok: 411_810, outputMicrodollarsPerMTok: 1_456_571 },
};
const SETTINGS: ModerationSettings = { modelId: MODEL_ID, inputTokenLimit: 8_000, maxExecutions: 3 };
const USAGE = { inputTokens: 100, outputTokens: 50 };

const CLEAN = JSON.stringify({ assessment: "no_profanity_detected", explanation: "No profanity.", matches: [], limitations: [] });
const UNCERTAIN = JSON.stringify({
  assessment: "uncertain",
  explanation: "Needs human review.",
  matches: [],
  limitations: ["Human review is required."],
});

const success = (content: string): FakeLlmOutcome => ({ kind: "success", content, usage: USAGE });
const UNAVAILABLE: FakeLlmOutcome = { kind: "failure", failure: { kind: "unavailable" } };
const RATE_LIMITED = (retryAfterSeconds: number | null): FakeLlmOutcome => ({
  kind: "failure",
  failure: { kind: "rate_limited", retryAfterSeconds },
});

let owner: Client;
let app: Database & Sql;
let other: Database & Sql;

function runtimeUrl(): string {
  const url = new URL(testDatabaseUrl());
  url.username = RUNTIME_ROLE;
  url.password = RUNTIME_PASSWORD;
  return url.href;
}

beforeAll(async () => {
  owner = await connectAsOwner();
  await createLoginRole(owner, RUNTIME_ROLE, RUNTIME_PASSWORD);
  app = createDatabase({ url: runtimeUrl(), caCert: null });
  other = createDatabase({ url: runtimeUrl(), caCert: null });
});

afterAll(async () => {
  await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1", [RUNTIME_ROLE]);
  await dropLoginRole(owner, RUNTIME_ROLE);
  await owner.end();
});

beforeEach(async () => {
  await owner.query(
    `TRUNCATE app.audit_entry, app.review_moderation, app.moderation_work, app.ai_budget_reservation, app.ai_job,
       app.ai_budget_day, app.scheduler_lease, app.rate_limit_window, app.moderation_strike, app.moderation_decision,
       app.report, app.session, app.review, app.movie, app.account CASCADE`,
  );
});

// ---------------------------------------------------------------------------------------------------------
// Fixtures

const seedReview = (seed: ReviewSeed = {}): Promise<SeededReview> => seedReviewRow(owner, seed);
const seedWork = (reviewId: ReviewId, seed: WorkSeed = {}): Promise<string> => seedWorkRow(owner, reviewId, seed);
const workRows = (reviewId: ReviewId): Promise<WorkRow[]> => workRowsOf(owner, reviewId);

async function onlyWork(reviewId: ReviewId): Promise<WorkRow> {
  const rows = await workRows(reviewId);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function reviewRow(reviewId: ReviewId) {
  const { rows } = await owner.query<{
    moderation_state: string;
    clearance_source: string | null;
    version: number;
    body: string;
    hidden_at: Date | null;
    deleted_at: Date | null;
  }>("SELECT moderation_state, clearance_source, version, body, hidden_at, deleted_at FROM app.review WHERE id = $1", [
    reviewId,
  ]);
  return rows[0]!;
}

async function count(table: string): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(`SELECT count(*)::integer AS n FROM app.${table}`);
  return rows[0]!.n;
}

async function jobRows() {
  const { rows } = await owner.query<{ id: string; status: string; error_code: string | null }>(
    "SELECT id, status, error_code FROM app.ai_job ORDER BY created_at, id",
  );
  return rows;
}

/** A-04 hide stand-in: Movie then Review lock (D-20), hidden_at, and the D-50 cancellation under the lock (D-58). */
async function adminHide(seeded: SeededReview): Promise<void> {
  await other.withTransaction(async (tx) => {
    await other.query(tx, "SELECT 1 FROM app.movie WHERE id = $1 FOR UPDATE", [seeded.movieId]);
    await other.query(tx, "SELECT 1 FROM app.review WHERE id = $1 FOR UPDATE", [seeded.reviewId]);
    await other.query(tx, "UPDATE app.review SET hidden_at = now(), version = version + 1 WHERE id = $1", [seeded.reviewId]);
    await other.query(
      tx,
      `UPDATE app.moderation_work SET status = 'cancelled', updated_at = now()
       WHERE review_id = $1 AND status IN ('pending', 'running', 'needs_manual_review')`,
      [seeded.reviewId],
    );
  });
}

/** A-04 restore stand-in (D-55): clears hidden_at and reactivates the current cancelled row in place. */
async function adminRestore(seeded: SeededReview): Promise<void> {
  await other.withTransaction(async (tx) => {
    await other.query(tx, "SELECT 1 FROM app.movie WHERE id = $1 FOR UPDATE", [seeded.movieId]);
    await other.query(tx, "SELECT 1 FROM app.review WHERE id = $1 FOR UPDATE", [seeded.reviewId]);
    await other.query(tx, "UPDATE app.review SET hidden_at = NULL, version = version + 1 WHERE id = $1", [seeded.reviewId]);
    await other.query(
      tx,
      `UPDATE app.moderation_work SET status = 'pending', next_attempt_at = now(), updated_at = now()
       WHERE review_id = $1 AND status = 'cancelled' AND prompt_version = $2 AND policy_version = $3`,
      [seeded.reviewId, REVIEW_SCREENING_PROMPT_VERSION, PROFANITY_POLICY_VERSION],
    );
  });
}

/** U-02 author-deletion stand-in: locks, deleted_at and K9 `cancelForDeletedReview` in one Tx. */
async function authorDelete(seeded: SeededReview): Promise<void> {
  const queue = createModerationWorkQueue({ sql: other });
  await other.withTransaction(async (tx) => {
    await other.query(tx, "SELECT 1 FROM app.movie WHERE id = $1 FOR UPDATE", [seeded.movieId]);
    await other.query(tx, "SELECT 1 FROM app.review WHERE id = $1 FOR UPDATE", [seeded.reviewId]);
    await other.query(tx, "UPDATE app.review SET deleted_at = now(), version = version + 1 WHERE id = $1", [
      seeded.reviewId,
    ]);
    await queue.cancelForDeletedReview(tx, seeded.reviewId);
  });
}

/** A-02 archive stand-in: Movie lock and archived_at. */
async function archiveMovie(seeded: SeededReview): Promise<void> {
  await owner.query("UPDATE app.movie SET archived_at = now() WHERE id = $1", [seeded.movieId]);
}

/** U-02 body-edit stand-in: new revision and K9 enqueue in the same Tx. */
async function editBody(seeded: SeededReview, revision: number): Promise<void> {
  const queue = createModerationWorkQueue({ sql: other });
  await other.withTransaction(async (tx) => {
    await other.query(tx, "SELECT 1 FROM app.movie WHERE id = $1 FOR UPDATE", [seeded.movieId]);
    await other.query(tx, "SELECT 1 FROM app.review WHERE id = $1 FOR UPDATE", [seeded.reviewId]);
    await other.query(
      tx,
      `UPDATE app.review SET body = 'Edited text.', content_revision = $2, moderation_state = 'pending',
              clearance_source = NULL, version = version + 1 WHERE id = $1`,
      [seeded.reviewId, revision],
    );
    await queue.enqueue(tx, seeded.reviewId, revision as ContentRevision);
  });
}

async function expireClaims(reviewId: ReviewId): Promise<void> {
  await owner.query(
    "UPDATE app.moderation_work SET next_attempt_at = now() - interval '1 second' WHERE review_id = $1 AND status = 'running'",
    [reviewId],
  );
}

// ---------------------------------------------------------------------------------------------------------
// Harness

type Dispatcher = ModerationDispatcher & ModerationRecovery;

interface Harness {
  readonly dispatcher: Dispatcher;
  readonly provider: FakeLlmProvider;
}

function dispatcherWith(controller: AiExecutionController, settings: Partial<ModerationSettings> = {}): Dispatcher {
  const database = instrumentDatabase(app);
  const reviews = createReviewRepository({ sql: database });
  const movieLocks = createMovieLocks({ sql: database });
  return createModerationDispatcher({
    database,
    reviewLocks: createReviewLocksAndReads({ reviews, movieLocks }),
    transitions: createReviewTransitions({ reviews, reviewsChangedMarker: createReviewsChangedMarker({ sql: database }) }),
    work: createModerationWorkRepository({ sql: database }),
    reviewReads: createModerationReviewReadRepository({ sql: database }),
    results: createReviewModerationRepository({ sql: database }),
    auditLog: createAuditLog({ sql: database }),
    controller,
    settings: { ...SETTINGS, ...settings },
  });
}

/** The composition root's wiring with the real K10 controller and a scripted provider. */
function harness(
  options: { readonly script?: readonly FakeLlmOutcome[]; readonly duringCall?: () => Promise<void> } = {},
): Harness {
  const provider = createFakeLlmProvider({ modelId: MODEL_ID, script: options.script ?? [] });
  const observed: LlmProvider = {
    modelId: provider.modelId,
    async complete(request) {
      await options.duringCall?.();
      return provider.complete(request);
    },
  };
  // With a race inside the call, sleeps fire only on demand, so the attempt timer cannot expire meanwhile.
  const time = createManualTime({ autoAdvance: options.duringCall === undefined });
  const controller = createAiExecutionController({
    database: app,
    sql: app,
    rateLimiter: createRateLimiter({ database: app, sql: app }),
    socRequestKey: createRateLimitKeys({ secret: "synthetic-rate-limit-key-secret-0123456789" }).forEnvironment(
      "soc_requests",
    ),
    provider: observed,
    limits: CONTROLLER_LIMITS,
    random: time.random,
    clock: time.clock,
    sleep: time.sleep,
  });
  return { dispatcher: dispatcherWith(controller), provider };
}

/** A K10 stand-in that returns one fixed outcome without publishing, or throws. */
function fixedController(outcome: AiExecutionOutcome | "throw"): AiExecutionController & { calls: number } {
  const controller = {
    calls: 0,
    async run() {
      controller.calls += 1;
      if (outcome === "throw") throw new Error("synthetic controller fault");
      return outcome;
    },
  };
  return controller;
}

const attempt = (dispatcher: Dispatcher, seeded: SeededReview, revision = 1) =>
  dispatcher.attemptAfterCommit(seeded.reviewId, revision as ContentRevision);

// ---------------------------------------------------------------------------------------------------------

describe("D-101 settlement table, outcome by outcome (AI-02: deferrals never consume an execution)", () => {
  it("defers a K10 deferral with its retry hint, capped at one day, and leaves the execution count", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { executionCount: 1, lastAttemptInSeconds: -3_600 });
    const before = await onlyWork(seeded.reviewId);

    await expect(
      attempt(dispatcherWith(fixedController({ kind: "deferred", retryAfterSeconds: 10 * 86_400 })), seeded),
    ).resolves.toBe("deferred");

    const work = await onlyWork(seeded.reviewId);
    expect(work).toMatchObject({ status: "pending", execution_count: 1 });
    expect(work.last_attempt_at).toEqual(before.last_attempt_at);
    expect(work.next_in_seconds).toBeGreaterThanOrEqual(86_400 - 5);
    expect(work.next_in_seconds).toBeLessThanOrEqual(86_400 + 5);
  });

  it("treats a deferral without a hint as due now", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);

    await expect(
      attempt(dispatcherWith(fixedController({ kind: "deferred", retryAfterSeconds: null })), seeded),
    ).resolves.toBe("deferred");

    const work = await onlyWork(seeded.reviewId);
    expect(work).toMatchObject({ status: "pending", execution_count: 0, last_attempt_at: null });
    expect(Math.abs(work.next_in_seconds)).toBeLessThanOrEqual(2);
  });

  for (const outcome of [{ kind: "disabled" }, { kind: "duplicate", jobId: FAKE_JOB_ID }] as const) {
    it(`returns ${outcome.kind} work to pending now with no execution consumed`, async () => {
      const seeded = await seedReview();
      await seedWork(seeded.reviewId);

      await expect(attempt(dispatcherWith(fixedController(outcome)), seeded)).resolves.toBe("deferred");

      const work = await onlyWork(seeded.reviewId);
      expect(work).toMatchObject({ status: "pending", execution_count: 0, last_attempt_at: null });
      expect(Math.abs(work.next_in_seconds)).toBeLessThanOrEqual(2);
    });
  }

  it("routes K10 input_too_large to manual review without counting an execution", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);

    await expect(attempt(dispatcherWith(fixedController({ kind: "input_too_large" })), seeded)).resolves.toBe(
      "manual_review",
    );

    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "needs_manual_review", execution_count: 0 });
    expect(await reviewRow(seeded.reviewId)).toMatchObject({ moderation_state: "pending" });
  });

  for (const cause of ["invalid_output", "provider_rejected"] as const) {
    it(`sends failed ${cause} straight to manual review with one execution counted`, async () => {
      const seeded = await seedReview();
      await seedWork(seeded.reviewId);

      await expect(
        attempt(dispatcherWith(fixedController({ kind: "failed", jobId: FAKE_JOB_ID, cause })), seeded),
      ).resolves.toBe("manual_review");

      const work = await onlyWork(seeded.reviewId);
      expect(work).toMatchObject({ status: "needs_manual_review", execution_count: 1 });
      expect(work.last_attempt_at).not.toBeNull();
    });
  }

  it("backs off 15 minutes × 4^(n − 1) under a larger configured limit, then stops at the limit", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const failing = dispatcherWith(fixedController({ kind: "failed", jobId: FAKE_JOB_ID, cause: "transient" }), {
      maxExecutions: 5,
    });
    const expected = [15 * 60, 60 * 60, 4 * 60 * 60, 16 * 60 * 60];

    for (const [index, seconds] of expected.entries()) {
      await expect(attempt(failing, seeded)).resolves.toBe("deferred");
      const work = await onlyWork(seeded.reviewId);
      expect(work).toMatchObject({ status: "pending", execution_count: index + 1 });
      expect(work.next_in_seconds).toBeGreaterThanOrEqual(seconds - 5);
      expect(work.next_in_seconds).toBeLessThanOrEqual(seconds + 5);
      await owner.query("UPDATE app.moderation_work SET next_attempt_at = now() WHERE review_id = $1", [seeded.reviewId]);
    }

    await expect(attempt(failing, seeded)).resolves.toBe("manual_review");
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "needs_manual_review", execution_count: 5 });
  });

  it("returns a stale result with no Review change to pending, attempted now, with no execution counted", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { executionCount: 2 });

    await expect(
      attempt(dispatcherWith(fixedController({ kind: "stale", jobId: FAKE_JOB_ID })), seeded),
    ).resolves.toBe("not_current");

    const work = await onlyWork(seeded.reviewId);
    expect(work).toMatchObject({ status: "pending", execution_count: 2 });
    expect(work.last_attempt_at).not.toBeNull();
  });

  it("never reaches manual review through repeated stale results", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const stale = dispatcherWith(fixedController({ kind: "stale", jobId: FAKE_JOB_ID }));

    for (let run = 0; run < 5; run += 1) {
      await expect(attempt(stale, seeded)).resolves.toBe("not_current");
    }

    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "pending", execution_count: 0 });
  });

  it("returns deferred when K10 throws, leaves the claim to expire, and recovery counts it once", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);

    await expect(attempt(dispatcherWith(fixedController("throw")), seeded)).resolves.toBe("deferred");

    const claimed = await onlyWork(seeded.reviewId);
    expect(claimed).toMatchObject({ status: "running", execution_count: 0 });
    expect(claimed.next_in_seconds).toBeGreaterThanOrEqual(115);

    // Before expiry another attempt must not double-run it.
    const busy = fixedController({ kind: "published", jobId: FAKE_JOB_ID });
    await expect(attempt(dispatcherWith(busy), seeded)).resolves.toBe("deferred");
    expect(busy.calls).toBe(0);

    await expireClaims(seeded.reviewId);
    await expect(attempt(harness({ script: [success(CLEAN)] }).dispatcher, seeded)).resolves.toBe("cleared");
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "completed", execution_count: 2 });
  });
});

describe("execution-count accounting across paths (AI-02, AT-24, D-77)", () => {
  it("keeps the count and last attempt after a 429 that follows a transient failure", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);

    await expect(attempt(harness({ script: [UNAVAILABLE, UNAVAILABLE] }).dispatcher, seeded)).resolves.toBe("deferred");
    const afterFailure = await onlyWork(seeded.reviewId);
    expect(afterFailure.execution_count).toBe(1);
    await owner.query("UPDATE app.moderation_work SET next_attempt_at = now() WHERE review_id = $1", [seeded.reviewId]);

    await expect(attempt(harness({ script: [RATE_LIMITED(120)] }).dispatcher, seeded)).resolves.toBe("deferred");

    const afterDeferral = await onlyWork(seeded.reviewId);
    expect(afterDeferral).toMatchObject({ status: "pending", execution_count: 1 });
    expect(afterDeferral.last_attempt_at).toEqual(afterFailure.last_attempt_at);
  });

  it("counts a recovered crash and the transient failure of the same attempt separately", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { status: "running", nextAttemptInSeconds: -1 });

    await expect(attempt(harness({ script: [UNAVAILABLE, UNAVAILABLE] }).dispatcher, seeded)).resolves.toBe("deferred");

    const work = await onlyWork(seeded.reviewId);
    expect(work).toMatchObject({ status: "pending", execution_count: 2 });
    // The backoff follows the count after both: 15 minutes × 4^(2 − 1).
    expect(work.next_in_seconds).toBeGreaterThanOrEqual(60 * 60 - 5);
    expect(work.next_in_seconds).toBeLessThanOrEqual(60 * 60 + 5);
  });

  it("reaches manual review when a recovered crash and a transient failure exhaust the limit", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { status: "running", executionCount: 1, nextAttemptInSeconds: -1 });

    await expect(attempt(harness({ script: [UNAVAILABLE, UNAVAILABLE] }).dispatcher, seeded)).resolves.toBe(
      "manual_review",
    );

    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "needs_manual_review", execution_count: 3 });
  });

  it("counts a recovered crash once even when the following attempt only defers", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { status: "running", nextAttemptInSeconds: -1 });

    await expect(attempt(harness({ script: [RATE_LIMITED(null), RATE_LIMITED(null)] }).dispatcher, seeded)).resolves.toBe("deferred");
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "pending", execution_count: 1 });

    await expect(attempt(harness({ script: [RATE_LIMITED(null), RATE_LIMITED(null)] }).dispatcher, seeded)).resolves.toBe("deferred");
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "pending", execution_count: 1 });
  });

  it("consumes nothing while the AI slot stays busy across many attempts, then counts one execution", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    await owner.query(
      "INSERT INTO app.scheduler_lease (name, lease_token, lease_until) VALUES ('ai_execution', gen_random_uuid(), now() + interval '1 minute')",
    );

    for (let run = 0; run < 4; run += 1) {
      await expect(attempt(harness({ script: [success(CLEAN)] }).dispatcher, seeded)).resolves.toBe("deferred");
    }
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "pending", execution_count: 0, last_attempt_at: null });

    await owner.query("DELETE FROM app.scheduler_lease WHERE name = 'ai_execution'");
    await expect(attempt(harness({ script: [success(CLEAN)] }).dispatcher, seeded)).resolves.toBe("cleared");
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "completed", execution_count: 1 });
  });

  it("keeps the text unchanged and unpublished through an outage that ends in manual review (AT-21)", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const before = await reviewRow(seeded.reviewId);

    for (let run = 0; run < 3; run += 1) {
      await attempt(harness({ script: [UNAVAILABLE, UNAVAILABLE] }).dispatcher, seeded);
      await owner.query("UPDATE app.moderation_work SET next_attempt_at = now() WHERE review_id = $1", [seeded.reviewId]);
    }

    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "needs_manual_review", execution_count: 3 });
    expect(await reviewRow(seeded.reviewId)).toEqual(before);
  });
});

describe("hide, delete and archive races during the provider call (AI-02, D-54, AT-21)", () => {
  it("cancels and publishes nothing when the author deletes the Review during the call", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)], duringCall: () => authorDelete(seeded) });

    await expect(attempt(h.dispatcher, seeded)).resolves.toBe("not_current");

    expect(await reviewRow(seeded.reviewId)).toMatchObject({ moderation_state: "pending", clearance_source: null });
    expect((await reviewRow(seeded.reviewId)).deleted_at).not.toBeNull();
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "cancelled", execution_count: 0 });
    expect(await count("review_moderation")).toBe(0);
    expect(await count("audit_entry")).toBe(0);
    expect((await jobRows()).map(({ status }) => status)).toEqual(["stale"]);
  });

  it("cancels a deletion that left the claim running, rather than publishing it", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({
      script: [success(CLEAN)],
      duringCall: async () => {
        await owner.query("UPDATE app.review SET deleted_at = now(), version = version + 1 WHERE id = $1", [
          seeded.reviewId,
        ]);
      },
    });

    await expect(attempt(h.dispatcher, seeded)).resolves.toBe("not_current");

    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "cancelled", execution_count: 0 });
    expect(await count("review_moderation")).toBe(0);
  });

  it("keeps an Admin hide that also cancelled the work, and never clears hidden_at", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)], duringCall: () => adminHide(seeded) });

    await expect(attempt(h.dispatcher, seeded)).resolves.toBe("not_current");

    const row = await reviewRow(seeded.reviewId);
    expect(row.hidden_at).not.toBeNull();
    expect(row).toMatchObject({ moderation_state: "pending", clearance_source: null });
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "cancelled", execution_count: 0 });
    expect(await count("review_moderation")).toBe(0);
  });

  it("publishes nothing when a hide and a restore both commit during the call, and keeps the reactivated work", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({
      script: [success(CLEAN)],
      duringCall: async () => {
        await adminHide(seeded);
        await adminRestore(seeded);
      },
    });

    await expect(attempt(h.dispatcher, seeded)).resolves.toBe("not_current");

    expect(await reviewRow(seeded.reviewId)).toMatchObject({ moderation_state: "pending", hidden_at: null });
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "pending", execution_count: 0 });
    expect(await count("review_moderation")).toBe(0);
  });

  it("defers, publishes nothing and consumes no execution when the Movie is archived during the call", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)], duringCall: () => archiveMovie(seeded) });

    await expect(attempt(h.dispatcher, seeded)).resolves.toBe("deferred");

    expect(await reviewRow(seeded.reviewId)).toMatchObject({ moderation_state: "pending", clearance_source: null });
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "pending", execution_count: 0 });
    expect(await count("review_moderation")).toBe(0);
  });

  it("records the archived-Movie stale attempt with last_attempt_at = now() (D-101 settlement table, stale row)", async () => {
    // D-101: a `stale` outcome that is not a hide, deletion, edit or loss of `pending` gives "pending with
    // next_attempt_at = now() and last_attempt_at = now(), execution_count unchanged", with result `deferred` on
    // an archived Movie. Archiving is not one of the claim steps 2–3 cases, so last_attempt_at must be set.
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)], duringCall: () => archiveMovie(seeded) });

    await attempt(h.dispatcher, seeded);

    expect((await onlyWork(seeded.reviewId)).last_attempt_at).not.toBeNull();
  });

  it("creates no Report, strike, decision or account change for a flag (AT-21, SEC-09)", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const { rows: before } = await owner.query("SELECT status, version FROM app.account WHERE id = $1", [seeded.authorId]);

    await expect(attempt(harness({ script: [success(UNCERTAIN)] }).dispatcher, seeded)).resolves.toBe("flagged");

    expect(await count("report")).toBe(0);
    expect(await count("moderation_strike")).toBe(0);
    expect(await count("moderation_decision")).toBe(0);
    const { rows: after } = await owner.query("SELECT status, version FROM app.account WHERE id = $1", [seeded.authorId]);
    expect(after).toEqual(before);
    expect((await reviewRow(seeded.reviewId)).hidden_at).toBeNull();
  });
});

describe("races between sweep selection and claim (D-54, D-58, D-101)", () => {
  async function sweepWithRace(dispatcher: Dispatcher, race: () => Promise<void>) {
    const reads = createModerationReviewReadRepository({ sql: app });
    return createModerationSweep({
      database: app,
      leases: createSchedulerLeases({ database: app, sql: app }),
      selection: {
        async selectDue(tx, limit) {
          const due = await reads.selectDue(tx, limit);
          await race();
          return due;
        },
      },
      recovery: dispatcher,
      limits: { maxReviews: 1 },
      log: { record: () => undefined },
    }).run(REQUEST_ID);
  }

  for (const [name, race] of [
    ["hidden", adminHide],
    ["deleted", authorDelete],
  ] as const) {
    it(`skips work whose Review was ${name} after selection, with no provider call, job or budget`, async () => {
      const seeded = await seedReview();
      await seedWork(seeded.reviewId);
      const h = harness({ script: [success(CLEAN)] });

      expect(await sweepWithRace(h.dispatcher, () => race(seeded))).toEqual({
        ok: true,
        value: { processed: 0, skipped: 1, deferred: 0, failed: 0 },
      });

      expect(h.provider.requests).toHaveLength(0);
      expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "cancelled", execution_count: 0 });
      expect(await count("ai_job")).toBe(0);
      expect(await count("ai_budget_reservation")).toBe(0);
      expect(await count("rate_limit_window")).toBe(0);
    });
  }

  it("cancels selected work for a hide that left the work pending (a hide without its own cancellation)", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)] });

    await sweepWithRace(h.dispatcher, async () => {
      await owner.query("UPDATE app.review SET hidden_at = now(), version = version + 1 WHERE id = $1", [seeded.reviewId]);
    });

    expect(h.provider.requests).toHaveLength(0);
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "cancelled" });
  });

  it("defers without writing when the Movie is archived after selection", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const before = await onlyWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)] });

    expect(await sweepWithRace(h.dispatcher, () => archiveMovie(seeded))).toEqual({
      ok: true,
      value: { processed: 0, skipped: 0, deferred: 1, failed: 0 },
    });

    expect(h.provider.requests).toHaveLength(0);
    expect(await onlyWork(seeded.reviewId)).toEqual(before);
  });

  it("skips the selected old revision after a body edit and keeps the new revision's work", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)] });

    expect(await sweepWithRace(h.dispatcher, () => editBody(seeded, 2))).toEqual({
      ok: true,
      value: { processed: 0, skipped: 1, deferred: 0, failed: 0 },
    });

    expect(h.provider.requests).toHaveLength(0);
    expect((await workRows(seeded.reviewId)).map(({ content_revision, status }) => [content_revision, status])).toEqual([
      [1, "superseded"],
      [2, "pending"],
    ]);
  });
});

describe("claim expiry boundary (D-101: next_attempt_at <= now())", () => {
  it("treats a claim ending exactly now as expired, and one microsecond later as live, in both reads", async () => {
    const seeded = await seedReview();
    const workId = await seedWork(seeded.reviewId, { status: "running", nextAttemptInSeconds: 60 });
    const work = createModerationWorkRepository({ sql: app });
    const reads = createModerationReviewReadRepository({ sql: app });

    await app.withTransaction(async (tx) => {
      // now() is fixed for the Tx, so this compares exactly equal values.
      await app.query(tx, "UPDATE app.moderation_work SET next_attempt_at = now() WHERE id = $1", [workId]);
      expect((await work.lockRevision(tx, seeded.reviewId, 1))[0]).toMatchObject({ id: workId, claimExpired: true });
      expect(await reads.selectDue(tx, 10)).toEqual([{ reviewId: seeded.reviewId, contentRevision: 1 }]);

      await app.query(
        tx,
        "UPDATE app.moderation_work SET next_attempt_at = now() + interval '1 microsecond' WHERE id = $1",
        [workId],
      );
      expect((await work.lockRevision(tx, seeded.reviewId, 1))[0]).toMatchObject({ id: workId, claimExpired: false });
      expect(await reads.selectDue(tx, 10)).toEqual([]);
    });
  });

  it("reports claimExpired false for every status other than running, whatever next_attempt_at is", async () => {
    const seeded = await seedReview();
    for (const status of ["pending", "completed", "needs_manual_review", "superseded", "cancelled"]) {
      await seedWork(seeded.reviewId, { status, nextAttemptInSeconds: -60, promptVersion: `p-${status}` });
    }
    const work = createModerationWorkRepository({ sql: app });

    const rows = await app.withTransaction((tx) => work.lockRevision(tx, seeded.reviewId, 1));

    expect(rows.every(({ claimExpired }) => !claimExpired)).toBe(true);
  });

  it("defers a claim a few seconds from expiry and recovers it once expired", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { status: "running", nextAttemptInSeconds: 3 });
    const live = harness({ script: [success(CLEAN)] });

    await expect(attempt(live.dispatcher, seeded)).resolves.toBe("deferred");
    expect(live.provider.requests).toHaveLength(0);
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "running", execution_count: 0 });

    await expireClaims(seeded.reviewId);
    await expect(attempt(harness({ script: [success(CLEAN)] }).dispatcher, seeded)).resolves.toBe("cleared");
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "completed", execution_count: 2 });
  });
});

describe("version migration (D-49, D-101 step 5)", () => {
  it("supersedes an abandoned running row under an old policy and screens under the current versions", async () => {
    const seeded = await seedReview();
    const oldId = await seedWork(seeded.reviewId, {
      status: "running",
      policyVersion: OLD_POLICY,
      executionCount: 2,
      nextAttemptInSeconds: -1,
    });
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h.dispatcher, seeded)).resolves.toBe("cleared");

    const rows = await workRows(seeded.reviewId);
    expect(rows.map(({ id, policy_version, status, execution_count }) => [id === oldId, policy_version, status, execution_count])).toEqual([
      [true, OLD_POLICY, "superseded", 2],
      [false, PROFANITY_POLICY_VERSION, "completed", 1],
    ]);
    expect(rows[1]).toMatchObject({ prompt_version: REVIEW_SCREENING_PROMPT_VERSION, model_id: MODEL_ID });
    const { rows: results } = await owner.query("SELECT policy_version, prompt_version FROM app.review_moderation");
    expect(results).toEqual([{ policy_version: PROFANITY_POLICY_VERSION, prompt_version: REVIEW_SCREENING_PROMPT_VERSION }]);
  });

  it("defers without writing while a running row under an old version holds a live claim", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { status: "running", policyVersion: OLD_POLICY, nextAttemptInSeconds: 60 });
    const before = await workRows(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h.dispatcher, seeded)).resolves.toBe("deferred");

    expect(h.provider.requests).toHaveLength(0);
    expect(await workRows(seeded.reviewId)).toEqual(before);
  });

  it("migrates pending work recorded under an older prompt version, not only an older policy", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { promptVersion: OLD_PROMPT });

    await expect(attempt(harness({ script: [success(CLEAN)] }).dispatcher, seeded)).resolves.toBe("cleared");

    expect((await workRows(seeded.reviewId)).map(({ prompt_version, status }) => [prompt_version, status])).toEqual([
      [OLD_PROMPT, "superseded"],
      [REVIEW_SCREENING_PROMPT_VERSION, "completed"],
    ]);
  });

  it("never reuses an old-version completed assessment and inserts no work for it", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { status: "completed", policyVersion: OLD_POLICY, executionCount: 1 });
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h.dispatcher, seeded)).resolves.toBe("not_current");

    expect(h.provider.requests).toHaveLength(0);
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "completed", policy_version: OLD_POLICY });
    expect(await reviewRow(seeded.reviewId)).toMatchObject({ moderation_state: "pending" });
  });

  it("migrates and screens an abandoned old-version row picked up by the recovery sweep", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { status: "running", policyVersion: OLD_POLICY, nextAttemptInSeconds: -1 });
    const h = harness({ script: [success(CLEAN)] });
    const reads = createModerationReviewReadRepository({ sql: app });

    const result = await createModerationSweep({
      database: app,
      leases: createSchedulerLeases({ database: app, sql: app }),
      selection: reads,
      recovery: h.dispatcher,
      limits: { maxReviews: 1 },
      log: { record: () => undefined },
    }).run(REQUEST_ID);

    expect(result).toEqual({ ok: true, value: { processed: 1, skipped: 0, deferred: 0, failed: 0 } });
    expect((await workRows(seeded.reviewId)).map(({ policy_version, status }) => [policy_version, status])).toEqual([
      [OLD_POLICY, "superseded"],
      [PROFANITY_POLICY_VERSION, "completed"],
    ]);
  });
});

describe("job status projection of jobs the dispatcher wrote (D-102)", () => {
  const readService = () =>
    createModerationJobReadService({ database: app, jobs: createModerationJobReadRepository({ sql: app }) });

  const FIELDS = ["createdAt", "errorCode", "id", "result", "retryAfterSeconds", "reviewId", "state", "updatedAt"];

  it("projects a succeeded job with its assessment and nothing private", async () => {
    const seeded = await seedReview({ body: "UNIQUE-BODY-CANARY a fine film" });
    await seedWork(seeded.reviewId);
    await attempt(harness({ script: [success(UNCERTAIN)] }).dispatcher, seeded);
    const [job] = await jobRows();

    const status = await readService().read(job!.id as AiJobId);

    expect(Object.keys(status!).sort()).toEqual(FIELDS);
    expect(status).toMatchObject({
      id: job!.id,
      reviewId: seeded.reviewId,
      state: "succeeded",
      retryAfterSeconds: null,
      result: { assessment: "uncertain" },
      errorCode: null,
    });
    const text = JSON.stringify(status);
    for (const secret of ["UNIQUE-BODY-CANARY", seeded.authorId, MODEL_ID, "Needs human review", "limitations"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("projects a job that lost to a human decision as stale with no result", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    await attempt(
      harness({
        script: [success(CLEAN)],
        duringCall: async () => {
          await owner.query(
            "UPDATE app.review SET moderation_state = 'cleared', clearance_source = 'admin', version = version + 1 WHERE id = $1",
            [seeded.reviewId],
          );
        },
      }).dispatcher,
      seeded,
    );
    const [job] = await jobRows();

    expect(await readService().read(job!.id as AiJobId)).toMatchObject({
      state: "stale",
      result: null,
      retryAfterSeconds: null,
      errorCode: job!.error_code,
    });
  });

  it("projects a provider 429 as a failed job with the fixed error code", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    await attempt(harness({ script: [RATE_LIMITED(120)] }).dispatcher, seeded);
    const [job] = await jobRows();

    expect(await readService().read(job!.id as AiJobId)).toMatchObject({
      state: "failed",
      result: null,
      errorCode: "provider_rate_limited",
    });
  });

  it("hides a summary job and an unknown ID", async () => {
    const seeded = await seedReview();
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO app.ai_job (type, trigger, subject_id, input_revision, dedup_key, status, lease_until, expires_at,
                               model_id, prompt_version, input_hash)
       VALUES ('summary', 'scheduler', $1, 1, gen_random_uuid()::text, 'succeeded', now(), now() + interval '1 day',
               'fake-model', 'synthetic-prompt-v1', 'synthetic-hash')
       RETURNING id`,
      [seeded.movieId],
    );

    expect(await readService().read(rows[0]!.id as AiJobId)).toBeNull();
    expect(await readService().read("60000000-0000-4000-8000-00000000ffff" as AiJobId)).toBeNull();
  });
});

describe("output that cannot be stored (probe)", () => {
  it("does not publish a quote that is half of a surrogate pair, and keeps the work", async () => {
    // D-100 exempts `quote` from the safe-text rule, including D-96's unpaired-surrogate check, because it copies
    // the body. A lone high surrogate is still a UTF-16 substring of a body holding an emoji.
    const seeded = await seedReview({ body: "Nice 😀 film" });
    await seedWork(seeded.reviewId);
    const output = JSON.stringify({
      assessment: "suspected_profanity",
      explanation: "A match.",
      matches: [{ quote: "\uD83D", reason: "Half a character." }],
      limitations: [],
    });

    const result = await attempt(harness({ script: [success(output)] }).dispatcher, seeded);

    expect(result).not.toBe("flagged");
    expect(result).not.toBe("cleared");
    expect(await reviewRow(seeded.reviewId)).toMatchObject({ moderation_state: "pending" });
    expect(await count("review_moderation")).toBe(0);
    expect(["pending", "needs_manual_review"]).toContain((await onlyWork(seeded.reviewId)).status);
  });

  it("routes that unstorable output to manual review as invalid output, not as a transient retry (AI-02)", async () => {
    // AI-02: "Invalid output ... go[es] directly to manual review." A quote that is half a character is not an
    // exact quotation and cannot be stored in jsonb (D-96).
    const seeded = await seedReview({ body: "Nice 😀 film" });
    await seedWork(seeded.reviewId);
    const output = JSON.stringify({
      assessment: "suspected_profanity",
      explanation: "A match.",
      matches: [{ quote: "\uD83D", reason: "Half a character." }],
      limitations: [],
    });

    await expect(attempt(harness({ script: [success(output)] }).dispatcher, seeded)).resolves.toBe("manual_review");
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "needs_manual_review" });
  });
});
