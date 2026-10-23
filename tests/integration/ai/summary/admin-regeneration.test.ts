import { randomBytes, randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createMarkerFakeLlmProvider } from "../../../../src/server/adapters/soc-llm/marker-fake-provider";
import { createDatabase, type Database, type Sql } from "../../../../src/server/db";
import { createReviewSummaryRepository, createSummaryInputRepository, createSummarySelectionRepository } from "../../../../src/server/repositories/summary";
import { createAiExecutionController } from "../../../../src/server/services/ai/runtime";
import { createSummaryGeneration, createSummaryInputPreparation, createSummaryPublisher } from "../../../../src/server/services/ai/summary";
import { createAdminSummaryRegenerationService } from "../../../../src/server/services/ai/summary/admin-regeneration";
import { createAuditLog, type AuditLog } from "../../../../src/server/services/audit";
import { createMovieLocks, createReviewsChangedMarker, createSummarySchedule } from "../../../../src/server/services/catalogue";
import type { Principal } from "../../../../src/server/services/identity";
import { createRateLimiter, createRateLimitKeys } from "../../../../src/server/services/rate-limit";
import type { AccountId, MovieId, RequestId, SessionId } from "../../../../src/server/shared";
import { createLoginRole, dropLoginRole } from "../../../setup/test-database.mjs";
import { createManualTime } from "../../../support/fakes/manual-time";
import { instrumentDatabase } from "../../../support/instrumented-database";
import { connectAsOwner } from "../../database/schema-fixtures";
import { testDatabaseUrl } from "../../database/test-database";

const RUNTIME_ROLE = `mp3_admin_summary_${randomBytes(4).toString("hex")}`;
const RUNTIME_PASSWORD = randomBytes(24).toString("hex");
const REQUEST_ID = "50000000-0000-4000-8000-000000000031" as RequestId;
const PENDING_SINCE = new Date("2026-01-02T03:04:05.000Z");
const keys = createRateLimitKeys({ secret: "synthetic-rate-limit-key-secret-0123456789" });
let owner: Client;
let app: Database & Sql;
let principal: Principal;

beforeAll(async () => {
  owner = await connectAsOwner();
  await createLoginRole(owner, RUNTIME_ROLE, RUNTIME_PASSWORD);
  const url = new URL(testDatabaseUrl());
  url.username = RUNTIME_ROLE;
  url.password = RUNTIME_PASSWORD;
  app = createDatabase({ url: url.href, caCert: null });
});

afterAll(async () => {
  await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1", [RUNTIME_ROLE]);
  await dropLoginRole(owner, RUNTIME_ROLE);
  await owner.end();
});

beforeEach(async () => {
  await owner.query(`TRUNCATE app.audit_entry, app.review_summary, app.ai_budget_reservation, app.ai_job,
    app.ai_budget_day, app.scheduler_lease, app.rate_limit_window, app.review, app.movie, app.account CASCADE`);
  const { rows } = await owner.query<{ id: AccountId }>(`INSERT INTO app.account
    (normalized_email, password_hash, display_name, role, status)
    VALUES ('admin@example.test', 'synthetic-hash', 'Synthetic Admin', 'ADMIN', 'active') RETURNING id`);
  principal = { accountId: rows[0]!.id, role: "ADMIN", sessionId: randomUUID() as SessionId };
});

async function seedMovie(count = 3, pending: Date | null = null): Promise<MovieId> {
  const { rows } = await owner.query<{ id: MovieId }>(`INSERT INTO app.movie
    (title, synopsis, director, reviews_revision, version, summary_pending_since, summary_last_success_at,
     summary_next_attempt_at)
    VALUES ('Synthetic Movie', 'Synthetic synopsis.', '', 4, 7, $1, now(), now() + interval '7 days') RETURNING id`, [pending]);
  const movieId = rows[0]!.id;
  await owner.query(`WITH authors AS (
    INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
    SELECT gen_random_uuid() || '@example.test', 'synthetic-hash', 'Synthetic', 'USER', 'active'
    FROM generate_series(1, $2::integer) RETURNING id)
    INSERT INTO app.review (movie_id, author_id, rating, body, moderation_state, clearance_source, version)
    SELECT $1, id, 7, 'Synthetic opinion. [fake-llm:summary]', 'cleared', 'ai', 2 FROM authors`, [movieId, count]);
  return movieId;
}

async function movie(movieId: MovieId) {
  const { rows } = await owner.query(`SELECT reviews_revision, version, summary_pending_since,
    summary_last_attempt_at, summary_next_attempt_at FROM app.movie WHERE id = $1`, [movieId]);
  return rows[0]!;
}

async function audits() {
  return (await owner.query(`SELECT actor_id, action, target_type, target_id, result,
    before_after_metadata, request_id FROM app.audit_entry ORDER BY created_at, id`)).rows;
}

function harness(options: { auditLog?: AuditLog; duringCall?: () => Promise<void> } = {}) {
  const database = instrumentDatabase(app);
  const time = createManualTime({ autoAdvance: options.duringCall === undefined });
  const fake = createMarkerFakeLlmProvider({ modelId: "fake-model" });
  const openDuringCall: number[] = [];
  const generation = createSummaryGeneration({
    preparation: createSummaryInputPreparation({ database, inputs: createSummaryInputRepository({ sql: database }),
      limits: { sampleSize: 20, inputTokenLimit: 8_000 }, seedSource: () => Buffer.alloc(32, 0x3c) }),
    controller: createAiExecutionController({ database, sql: database,
      rateLimiter: createRateLimiter({ database, sql: database }), socRequestKey: keys.forEnvironment("soc_requests"),
      provider: { modelId: fake.modelId, async complete(request) {
        openDuringCall.push(database.openTransactions);
        await options.duringCall?.();
        return fake.complete(request);
      } },
      limits: { maxAttempts: 2, attemptTimeoutMs: 30_000, executionDeadlineMs: 75_000, inputTokenLimit: 8_000,
        requestsPerMinute: 1_000, dailyBudgetMicrodollars: 50_000_000,
        prices: { inputMicrodollarsPerMTok: 411_810, outputMicrodollarsPerMTok: 1_456_571 } },
      random: time.random, clock: time.clock, sleep: time.sleep }),
    publisher: createSummaryPublisher({ movieLocks: createMovieLocks({ sql: database }),
      schedule: createSummarySchedule({ sql: database }), summaries: createReviewSummaryRepository({ sql: database }) }),
  });
  const service = createAdminSummaryRegenerationService({ database,
    rateLimiter: createRateLimiter({ database, sql: database }), rateLimitKeys: keys,
    movieLocks: createMovieLocks({ sql: database }), marker: createReviewsChangedMarker({ sql: database }),
    schedule: createSummarySchedule({ sql: database }), clock: createSummarySelectionRepository({ sql: database }),
    auditLog: options.auditLog ?? createAuditLog({ sql: database }), generation, log: { record: vi.fn() },
  });
  return { service, generation, openDuringCall };
}

describe("Admin summary regeneration — FR-08 / AI-01", () => {
  it("regenerates unchanged reviews despite recent success, commits before AI, and records manual provenance", async () => {
    const movieId = await seedMovie();
    // Establish an actual current summary through the scheduler path, rather than seeding an invalid projection.
    const initial = harness().generation;
    expect(await initial.generate(movieId)).toMatchObject({ kind: "published" });
    expect(await initial.generate(movieId)).toMatchObject({ kind: "current" });
    const previousJob = (await owner.query("SELECT id FROM app.ai_job")).rows[0]!.id as string;
    const reviewsBefore = (await owner.query("SELECT * FROM app.review ORDER BY id")).rows;
    const { service, openDuringCall } = harness({ duringCall: async () => {
      expect(await movie(movieId)).toMatchObject({ reviews_revision: 5, version: 7 });
      expect(await audits()).toEqual([expect.objectContaining({ actor_id: principal.accountId,
        action: "movie.summary_regenerate", target_type: "movie", target_id: movieId, result: "applied",
        before_after_metadata: { newReviewsRevision: 5 }, request_id: REQUEST_ID })]);
      expect((await owner.query(`SELECT count(*)::integer AS count FROM app.review_summary s
        JOIN app.movie m ON m.id = s.movie_id AND m.reviews_revision = s.reviews_revision
        WHERE m.id = $1`, [movieId])).rows[0]!.count).toBe(0);
    } });
    expect(await service.regenerate(movieId, principal, REQUEST_ID)).toEqual({ ok: true, value: { status: "generated" } });
    expect(openDuringCall).toEqual([0]);
    expect(await movie(movieId)).toMatchObject({ reviews_revision: 5, version: 7, summary_pending_since: null });
    expect((await owner.query("SELECT * FROM app.review ORDER BY id")).rows).toEqual(reviewsBefore);
    expect((await owner.query(`SELECT trigger, requester_id, input_revision, status FROM app.ai_job
      WHERE id <> $1`, [previousJob])).rows).toEqual([
      { trigger: "admin_request", requester_id: principal.accountId, input_revision: 5, status: "succeeded" },
    ]);
    expect((await owner.query("SELECT reviews_revision FROM app.review_summary ORDER BY reviews_revision")).rows)
      .toEqual([{ reviews_revision: 4 }, { reviews_revision: 5 }]);
  }, 30_000);

  it("invalidates insufficient input, preserves oldest pending time and applies throttle before another write", async () => {
    const movieId = await seedMovie(2, PENDING_SINCE);
    const { service, openDuringCall } = harness();
    expect(await service.regenerate(movieId, principal, REQUEST_ID))
      .toEqual({ ok: true, value: { status: "insufficient_reviews" } });
    const after = await movie(movieId);
    expect(after).toMatchObject({ reviews_revision: 5, version: 7, summary_pending_since: PENDING_SINCE });
    expect(after.summary_next_attempt_at.getTime() - after.summary_last_attempt_at.getTime()).toBe(86_400_000);
    expect(await service.regenerate(movieId, principal, REQUEST_ID)).toEqual({ ok: false,
      error: { kind: "rate_limited", retryAfterSeconds: expect.any(Number) } });
    expect(await movie(movieId)).toEqual(after);
    expect(await audits()).toHaveLength(1);
    expect((await owner.query("SELECT id FROM app.ai_job")).rows).toEqual([]);
    expect(openDuringCall).toEqual([]);
  });

  it("rolls back revision, pending marker and scheduling when the audit insert fails", async () => {
    const movieId = await seedMovie();
    const before = await movie(movieId);
    const { service, openDuringCall } = harness({ auditLog: { record: async () => {
      throw new Error("synthetic audit failure");
    } } });
    await expect(service.regenerate(movieId, principal, REQUEST_ID)).rejects.toThrow("synthetic audit failure");
    expect(await movie(movieId)).toEqual(before);
    expect(await audits()).toEqual([]);
    expect((await owner.query("SELECT id FROM app.ai_job")).rows).toEqual([]);
    expect(openDuringCall).toEqual([]);
  });
});
