import { randomBytes } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { createMarkerFakeLlmProvider } from "../../../../src/server/adapters/soc-llm/marker-fake-provider";
import { createDatabase, type Database, type Sql } from "../../../../src/server/db";
import {
  createModerationReviewReadRepository,
  createModerationWorkRepository,
  createReviewModerationRepository,
} from "../../../../src/server/repositories/ai";
import { createReviewRepository } from "../../../../src/server/repositories/reviews";
import {
  createModerationDispatcher,
  createModerationSweep,
  type ModerationSweep,
  type ModerationSweepLogLine,
} from "../../../../src/server/services/ai/moderation";
import { createAiExecutionController, createSchedulerLeases } from "../../../../src/server/services/ai/runtime";
import { createAuditLog } from "../../../../src/server/services/audit";
import { createMovieLocks, createReviewsChangedMarker } from "../../../../src/server/services/catalogue";
import { createRateLimiter, createRateLimitKeys } from "../../../../src/server/services/rate-limit";
import { createReviewLocksAndReads, createReviewTransitions } from "../../../../src/server/services/reviews";
import type { RequestId, ReviewId } from "../../../../src/server/shared";
import { createLoginRole, dropLoginRole } from "../../../setup/test-database.mjs";
import { createManualTime } from "../../../support/fakes/manual-time";
import { connectAsOwner } from "../../database/schema-fixtures";
import { testDatabaseUrl } from "../../database/test-database";
import { seedReview, seedWork, workRows, type ReviewSeed, type WorkSeed } from "./fixtures";

// The DEP-10 recovery sweep (D-101) against PostgreSQL: selection, crash recovery and the sweep lease, with the
// real dispatcher, K10 controller and marker fake (D-57).

const RUNTIME_ROLE = `mp3_mod_sweep_${randomBytes(4).toString("hex")}`;
const RUNTIME_PASSWORD = randomBytes(24).toString("hex");
const REQUEST_ID = "50000000-0000-4000-8000-000000000301" as RequestId;
const CLEAN_BODY = "A lovely, gentle film. [fake-llm:clean]";

let owner: Client;
let app: Database & Sql;

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
});

afterAll(async () => {
  await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1", [RUNTIME_ROLE]);
  await dropLoginRole(owner, RUNTIME_ROLE);
  await owner.end();
});

beforeEach(async () => {
  await owner.query(
    `TRUNCATE app.audit_entry, app.review_moderation, app.moderation_work, app.ai_budget_reservation, app.ai_job,
       app.ai_budget_day, app.scheduler_lease, app.rate_limit_window, app.review, app.movie, app.account CASCADE`,
  );
});

const selection = () => createModerationReviewReadRepository({ sql: app });

async function selectDue(limit: number): Promise<ReviewId[]> {
  const due = await app.withTransaction((tx) => selection().selectDue(tx, limit));
  return due.map(({ reviewId }) => reviewId);
}

async function seed(review: ReviewSeed = {}, work: WorkSeed = {}): Promise<ReviewId> {
  const { reviewId } = await seedReview(owner, review);
  await seedWork(owner, reviewId, work);
  return reviewId;
}

function sweepWith(maxReviews: number, logs: ModerationSweepLogLine[] = []): ModerationSweep {
  const time = createManualTime();
  const reviews = createReviewRepository({ sql: app });
  const movieLocks = createMovieLocks({ sql: app });
  const dispatcher = createModerationDispatcher({
    database: app,
    reviewLocks: createReviewLocksAndReads({ reviews, movieLocks }),
    transitions: createReviewTransitions({ reviews, reviewsChangedMarker: createReviewsChangedMarker({ sql: app }) }),
    work: createModerationWorkRepository({ sql: app }),
    reviewReads: selection(),
    results: createReviewModerationRepository({ sql: app }),
    auditLog: createAuditLog({ sql: app }),
    controller: createAiExecutionController({
      database: app,
      sql: app,
      rateLimiter: createRateLimiter({ database: app, sql: app }),
      socRequestKey: createRateLimitKeys({ secret: "synthetic-rate-limit-key-secret-0123456789" }).forEnvironment(
        "soc_requests",
      ),
      provider: createMarkerFakeLlmProvider({ modelId: "fake-model" }),
      limits: {
        maxAttempts: 2,
        attemptTimeoutMs: 30_000,
        executionDeadlineMs: 75_000,
        inputTokenLimit: 8_000,
        requestsPerMinute: 1_000,
        dailyBudgetMicrodollars: 50_000_000,
        prices: { inputMicrodollarsPerMTok: 411_810, outputMicrodollarsPerMTok: 1_456_571 },
      },
      random: time.random,
      clock: time.clock,
      sleep: time.sleep,
    }),
    settings: { modelId: "fake-model", inputTokenLimit: 8_000, maxExecutions: 3 },
  });
  return createModerationSweep({
    database: app,
    leases: createSchedulerLeases({ database: app, sql: app }),
    selection: selection(),
    recovery: dispatcher,
    limits: { maxReviews },
    log: { record: (line) => logs.push(line) },
  });
}

describe("selection (D-101, D-54)", () => {
  it("orders never-attempted work first, then the oldest last attempt, then ID", async () => {
    const recent = await seed({}, { lastAttemptInSeconds: -60 });
    const older = await seed({}, { lastAttemptInSeconds: -3_600 });
    const neverA = await seed();
    const neverB = await seed();
    const [firstNever, secondNever] = await owner
      .query<{ review_id: ReviewId }>(
        "SELECT review_id FROM app.moderation_work WHERE review_id = ANY($1::uuid[]) ORDER BY id",
        [[neverA, neverB]],
      )
      .then(({ rows }) => rows.map(({ review_id }) => review_id));

    expect(await selectDue(10)).toEqual([firstNever, secondNever, older, recent]);
  });

  it("returns at most the limit", async () => {
    await seed();
    await seed();

    expect(await selectDue(1)).toHaveLength(1);
  });

  it("never selects work of hidden or deleted Reviews or archived Movies, so it cannot hold the slot", async () => {
    await seed({ hidden: true });
    await seed({ deleted: true });
    await seed({ archivedMovie: true });
    const visible = await seed({}, { lastAttemptInSeconds: -60 });

    expect(await selectDue(1)).toEqual([visible]);
  });

  it("selects pending work that is due and running work whose claim has expired", async () => {
    await seed({}, { nextAttemptInSeconds: 600 });
    await seed({}, { status: "running", nextAttemptInSeconds: 60 });
    const due = await seed({}, { lastAttemptInSeconds: -10 });
    const abandoned = await seed({}, { status: "running", nextAttemptInSeconds: -1, lastAttemptInSeconds: -20 });

    expect(await selectDue(10)).toEqual([abandoned, due]);
  });

  it("never selects final or manual-review work", async () => {
    for (const status of ["completed", "needs_manual_review", "superseded", "cancelled"]) {
      await seed({}, { status });
    }

    expect(await selectDue(10)).toEqual([]);
  });

  it("selects pending work under an older version, so D-49 migration happens at dispatch", async () => {
    const old = await seed({}, { policyVersion: "profanity-policy-v0" });

    expect(await selectDue(1)).toEqual([old]);
  });
});

describe("recovery sweep (DEP-10, AT-24)", () => {
  it("recovers work left after commit by a crashed request and clears the Review", async () => {
    // The review write committed, then its function died before or during the attempt.
    const reviewId = await seed({ body: CLEAN_BODY }, { status: "running", nextAttemptInSeconds: -1 });
    const logs: ModerationSweepLogLine[] = [];

    expect(await sweepWith(1, logs).run(REQUEST_ID)).toEqual({
      ok: true,
      value: { processed: 1, skipped: 0, deferred: 0, failed: 0 },
    });

    // The crashed claim counts as one failed execution (D-77, D-101), the recovered run as the second.
    expect((await workRows(owner, reviewId))[0]).toMatchObject({ status: "completed", execution_count: 2 });
    const { rows } = await owner.query("SELECT moderation_state FROM app.review WHERE id = $1", [reviewId]);
    expect(rows).toEqual([{ moderation_state: "cleared" }]);
    expect(logs).toEqual([expect.objectContaining({ outcome: "completed", reviewId, result: "cleared" })]);
    expect(JSON.stringify(logs)).not.toContain("lovely");
  });

  it("processes one Review per run and then the next", async () => {
    const first = await seed({ body: CLEAN_BODY });
    const second = await seed({ body: CLEAN_BODY }, { lastAttemptInSeconds: -60 });
    const sweep = sweepWith(1);

    await sweep.run(REQUEST_ID);
    expect((await workRows(owner, first))[0]!.status).toBe("completed");
    expect((await workRows(owner, second))[0]!.status).toBe("pending");

    await sweep.run(REQUEST_ID);
    expect((await workRows(owner, second))[0]!.status).toBe("completed");
  });

  it("skips an overlapping invocation while another holds the sweep lease", async () => {
    const reviewId = await seed({ body: CLEAN_BODY });
    await owner.query(
      `INSERT INTO app.scheduler_lease (name, lease_token, lease_until)
       VALUES ('review_moderation_sweep', gen_random_uuid(), now() + interval '1 minute')`,
    );
    const logs: ModerationSweepLogLine[] = [];

    expect(await sweepWith(1, logs).run(REQUEST_ID)).toEqual({
      ok: true,
      value: { processed: 0, skipped: 0, deferred: 0, failed: 0 },
    });
    expect((await workRows(owner, reviewId))[0]!.status).toBe("pending");
    expect(logs).toEqual([expect.objectContaining({ outcome: "lease_held" })]);
  });

  it("counts a provider without a marker as deferred and consumes an execution only for the transient failure", async () => {
    const reviewId = await seed({ body: "No marker, so the fake is unavailable." });

    expect(await sweepWith(1).run(REQUEST_ID)).toEqual({
      ok: true,
      value: { processed: 0, skipped: 0, deferred: 1, failed: 0 },
    });
    expect((await workRows(owner, reviewId))[0]).toMatchObject({ status: "pending", execution_count: 1 });
  });

  it("counts invalid output as failed and routes it to manual review", async () => {
    const reviewId = await seed({ body: "Bad output follows. [fake-llm:invalid]" });

    expect(await sweepWith(1).run(REQUEST_ID)).toEqual({
      ok: true,
      value: { processed: 0, skipped: 0, deferred: 0, failed: 1 },
    });
    expect((await workRows(owner, reviewId))[0]!.status).toBe("needs_manual_review");
  });
});
