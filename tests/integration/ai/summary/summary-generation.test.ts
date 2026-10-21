import { randomBytes, randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { LlmProvider } from "../../../../src/server/adapters/soc-llm";
import {
  createMarkerFakeLlmProvider,
  MARKER_FAKE_SUMMARY_OUTPUT,
  MARKER_FAKE_USAGE,
} from "../../../../src/server/adapters/soc-llm/marker-fake-provider";
import type { AiSettings } from "../../../../src/server/config";
import { createDatabase, type Database, type Sql } from "../../../../src/server/db";
import { createReviewSummaryRepository, createSummaryInputRepository } from "../../../../src/server/repositories/summary";
import {
  createAiExecutionController,
  createAiRuntime,
  type AiExecutionController,
  type AiExecutionLimits,
} from "../../../../src/server/services/ai/runtime";
import {
  createSummaryGeneration,
  createSummaryInputPreparation,
  createSummaryPublisher,
  prepareSummaryInput,
  SUMMARY_PROMPT_VERSION,
  type SummaryGeneration,
  type SummaryLimits,
} from "../../../../src/server/services/ai/summary";
import {
  createMovieLocks,
  createReviewsChangedMarker,
  createSummarySchedule,
} from "../../../../src/server/services/catalogue";
import { createRateLimiter, createRateLimitKeys } from "../../../../src/server/services/rate-limit";
import type {
  AiJobId,
  ContentRevision,
  MovieId,
  ReviewId,
  ReviewsRevision,
  RowVersion,
} from "../../../../src/server/shared";
import { createLoginRole, dropLoginRole } from "../../../setup/test-database.mjs";
import { createManualTime, type ManualTime } from "../../../support/fakes/manual-time";
import { instrumentDatabase, type InstrumentedDatabase } from "../../../support/instrumented-database";
import { connectAsOwner } from "../../database/schema-fixtures";
import { testDatabaseUrl } from "../../database/test-database";

// Summary generation through the real K10 controller, real K7 and the marker fake (D-93 test requirements).
// Review rows are synthetic stand-ins for U-02 (D-91); they are not evidence for real review writes.

// A per-file login role with exactly app_runtime's privileges (D-31, D-32). Generated per run; never recorded.
const RUNTIME_ROLE = `mp3_summary_${randomBytes(4).toString("hex")}`;
const RUNTIME_PASSWORD = randomBytes(24).toString("hex");

const MODEL_ID = "fake-model";
const SEED = Buffer.alloc(32, 0x3c);
const REVISION = 4;
const PENDING_SINCE = new Date("2026-01-02T03:04:05.000Z");
const SOC_REQUESTS_KEY = createRateLimitKeys({ secret: "synthetic-rate-limit-key-secret-0123456789" }).forEnvironment(
  "soc_requests",
);
const SUMMARY_LIMITS: SummaryLimits = { sampleSize: 20, inputTokenLimit: 8_000 };
const CONTROLLER_LIMITS: AiExecutionLimits = {
  maxAttempts: 2,
  attemptTimeoutMs: 30_000,
  executionDeadlineMs: 75_000,
  inputTokenLimit: 8_000,
  requestsPerMinute: 1_000,
  dailyBudgetMicrodollars: 50_000_000,
  prices: { inputMicrodollarsPerMTok: 411_810, outputMicrodollarsPerMTok: 1_456_571 },
};
const VALID_OUTPUT = JSON.parse(MARKER_FAKE_SUMMARY_OUTPUT) as Record<string, unknown>;

let owner: Client;
/** Each pool holds one connection: `app` is the generating instance, `other` a second server instance. */
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
  // The pools have no close operation, so end their sessions before dropping the role.
  await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1", [RUNTIME_ROLE]);
  await dropLoginRole(owner, RUNTIME_ROLE);
  await owner.end();
});

beforeEach(async () => {
  await owner.query(
    `TRUNCATE app.review_summary, app.ai_budget_reservation, app.ai_job, app.ai_budget_day, app.scheduler_lease,
       app.rate_limit_window, app.review, app.movie, app.account CASCADE`,
  );
});

// ---------------------------------------------------------------------------------------------------------
// Fixtures

/** An active Movie at REVISION with a pending marker and no attempt yet. */
async function seedMovie(): Promise<MovieId> {
  const { rows } = await owner.query<{ id: MovieId }>(
    `INSERT INTO app.movie (title, synopsis, director, reviews_revision, summary_pending_since)
     VALUES ('Synthetic Movie', 'Synthetic synopsis.', '', $1, $2) RETURNING id`,
    [REVISION, PENDING_SINCE],
  );
  return rows[0]!.id;
}

/** Inserts `count` eligible synthetic Reviews with rating 7, each by a new synthetic account. */
async function seedReviews(movieId: MovieId, count: number, body: string): Promise<string[]> {
  const { rows } = await owner.query<{ id: string }>(
    `WITH authors AS (
       INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
       SELECT gen_random_uuid() || '@example.test', 'synthetic-hash', 'Synthetic', 'USER', 'active'
       FROM generate_series(1, $2::integer)
       RETURNING id
     )
     INSERT INTO app.review (movie_id, author_id, rating, body, moderation_state, clearance_source, version)
     SELECT $1, id, 7, $3, 'cleared', 'ai', 2 FROM authors
     RETURNING id`,
    [movieId, count, body],
  );
  return rows.map(({ id }) => id).sort();
}

async function seedMovieWithReviews(count: number, marker = "summary"): Promise<{ movieId: MovieId; reviewIds: string[] }> {
  const movieId = await seedMovie();
  const reviewIds = await seedReviews(movieId, count, `A synthetic opinion. [fake-llm:${marker}]`);
  return { movieId, reviewIds };
}

/** A succeeded summary job and its ReviewSummary, written as an earlier generation would have. */
async function insertExistingSummary(movieId: MovieId, revision: number, promptVersion: string): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app.ai_job (type, trigger, subject_id, input_revision, dedup_key, status, lease_until, expires_at,
                             model_id, prompt_version, input_hash)
     VALUES ('summary', 'scheduler', $1, $2, $3, 'succeeded', now(), now() + interval '7 days', $4, $5,
             'synthetic-hash')
     RETURNING id`,
    [movieId, revision, randomUUID(), MODEL_ID, promptVersion],
  );
  const jobId = rows[0]!.id;
  await owner.query(
    `INSERT INTO app.review_summary
       (job_id, movie_id, reviews_revision, sampled_review_ids_and_versions, eligible_count, output_json, generated_at)
     VALUES ($1, $2, $3, '{}'::jsonb, 3, $4::jsonb, now())`,
    [jobId, movieId, revision, MARKER_FAKE_SUMMARY_OUTPUT],
  );
  return jobId;
}

interface MovieRow {
  readonly archived_at: Date | null;
  readonly reviews_revision: number;
  readonly version: number;
  readonly summary_pending_since: Date | null;
  readonly summary_next_attempt_at: Date | null;
  readonly summary_last_attempt_at: Date | null;
  readonly summary_last_success_at: Date | null;
}

async function movie(movieId: MovieId): Promise<MovieRow> {
  const { rows } = await owner.query<MovieRow>(
    `SELECT archived_at, reviews_revision, version, summary_pending_since, summary_next_attempt_at,
            summary_last_attempt_at, summary_last_success_at
     FROM app.movie WHERE id = $1`,
    [movieId],
  );
  return rows[0]!;
}

interface SummaryRow {
  readonly id: string;
  readonly job_id: string;
  readonly reviews_revision: number;
  readonly sampled_review_ids_and_versions: Record<string, unknown>;
  readonly eligible_count: number;
  readonly output_json: Record<string, unknown>;
  readonly generated_at: Date;
}

async function summaries(movieId: MovieId): Promise<SummaryRow[]> {
  const { rows } = await owner.query<SummaryRow>(
    `SELECT id, job_id, reviews_revision, sampled_review_ids_and_versions, eligible_count, output_json, generated_at
     FROM app.review_summary WHERE movie_id = $1 ORDER BY generated_at, id`,
    [movieId],
  );
  return rows;
}

interface JobRow {
  readonly id: string;
  readonly type: string;
  readonly subject_id: string;
  readonly input_revision: number;
  readonly status: string;
  readonly error_code: string | null;
  readonly prompt_version: string;
  readonly model_id: string;
  readonly bounded_input_snapshot: Record<string, unknown> | null;
}

async function jobs(): Promise<JobRow[]> {
  const { rows } = await owner.query<JobRow>(
    `SELECT id, type, subject_id, input_revision, status, error_code, prompt_version, model_id, bounded_input_snapshot
     FROM app.ai_job ORDER BY created_at, id`,
  );
  return rows;
}

async function count(table: "ai_job" | "ai_budget_reservation" | "review_summary"): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(`SELECT count(*)::integer AS n FROM app.${table}`);
  return rows[0]!.n;
}

/** Asserts that a failed or rolled-back generation left no summary and the Movie's schedule untouched. */
async function expectNothingPublished(movieId: MovieId, before: MovieRow): Promise<void> {
  expect(await summaries(movieId)).toEqual([]);
  expect(await movie(movieId)).toEqual(before);
}

// ---------------------------------------------------------------------------------------------------------
// Harness

interface Harness {
  readonly generation: SummaryGeneration;
  readonly database: InstrumentedDatabase;
  /** `database.openTransactions` at the start of each provider call. */
  readonly openDuringCall: number[];
}

function contentProvider(content: string): LlmProvider {
  return {
    modelId: MODEL_ID,
    complete: async () => ({ ok: true, value: { content, usage: MARKER_FAKE_USAGE } }),
  };
}

function controllerFor(
  database: InstrumentedDatabase,
  provider: LlmProvider,
  limits: Partial<AiExecutionLimits>,
  time: ManualTime,
): AiExecutionController {
  return createAiExecutionController({
    database,
    sql: database,
    rateLimiter: createRateLimiter({ database, sql: database }),
    socRequestKey: SOC_REQUESTS_KEY,
    provider,
    limits: { ...CONTROLLER_LIMITS, ...limits },
    random: time.random,
    clock: time.clock,
    sleep: time.sleep,
  });
}

/**
 * The composition root's wiring (D-93) with the real controller. `duringCall` runs inside the provider call,
 * after K10 step 1 committed and before the publish Tx, which is where concurrent changes race the publication.
 */
function harness(
  options: {
    readonly provider?: LlmProvider;
    readonly duringCall?: () => Promise<void>;
    readonly summaryLimits?: SummaryLimits;
    readonly controllerLimits?: Partial<AiExecutionLimits>;
  } = {},
): Harness {
  const database = instrumentDatabase(app);
  const inner = options.provider ?? createMarkerFakeLlmProvider({ modelId: MODEL_ID });
  const openDuringCall: number[] = [];
  const provider: LlmProvider = {
    modelId: inner.modelId,
    async complete(request) {
      openDuringCall.push(database.openTransactions);
      await options.duringCall?.();
      return inner.complete(request);
    },
  };
  const generation = createSummaryGeneration({
    preparation: createSummaryInputPreparation({
      database,
      inputs: createSummaryInputRepository({ sql: database }),
      limits: options.summaryLimits ?? SUMMARY_LIMITS,
      seedSource: () => SEED,
    }),
    // A hook does real I/O during the call; an auto-advancing clock would fire the attempt timeout meanwhile.
    controller: controllerFor(
      database,
      provider,
      options.controllerLimits ?? {},
      createManualTime({ autoAdvance: options.duringCall === undefined }),
    ),
    publisher: createSummaryPublisher({
      movieLocks: createMovieLocks({ sql: database }),
      schedule: createSummarySchedule({ sql: database }),
      summaries: createReviewSummaryRepository({ sql: database }),
    }),
  });
  return { generation, database, openDuringCall };
}

/** A real K7 review change committed by another server instance, as U-02 will make (D-91 stand-in). */
async function markReviewsChangedElsewhere(movieId: MovieId): Promise<void> {
  const locks = createMovieLocks({ sql: other });
  const marker = createReviewsChangedMarker({ sql: other });
  await other.withTransaction(async (tx) => {
    const lock = await locks.lockActiveMovieForUpdate(tx, movieId);
    if (!lock.ok) {
      throw new Error("movie not lockable");
    }
    await marker.markReviewsChanged(tx, lock.value);
  });
}

// ---------------------------------------------------------------------------------------------------------

describe("summary generation publishes through K10 (AI-01, D-93)", () => {
  it("publishes the validated output, the included sample and the eligible count, and clears pending", async () => {
    const { movieId, reviewIds } = await seedMovieWithReviews(5);
    const h = harness();

    const outcome = await h.generation.generate(movieId);

    expect(outcome).toEqual({ kind: "published", jobId: expect.any(String) });
    const jobId = (outcome as { jobId: AiJobId }).jobId;
    const [row, ...more] = await summaries(movieId);
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      job_id: jobId,
      reviews_revision: REVISION,
      eligible_count: 5,
      output_json: VALID_OUTPUT,
      generated_at: expect.any(Date),
    });
    const sample = row!.sampled_review_ids_and_versions as {
      algorithm: string;
      seed: string;
      sampledCount: number;
      reviews: { reviewId: string; version: number; contentRevision: number; truncated: boolean }[];
    };
    expect(sample).toMatchObject({ algorithm: "summary-sample-v1", seed: SEED.toString("hex"), sampledCount: 5 });
    expect(sample.reviews.map(({ reviewId }) => reviewId).sort()).toEqual(reviewIds);
    expect(sample.reviews.every((r) => r.version === 2 && r.contentRevision === 1 && r.truncated === false)).toBe(true);

    expect(await jobs()).toEqual([
      expect.objectContaining({
        id: jobId,
        type: "summary",
        subject_id: movieId,
        input_revision: REVISION,
        status: "succeeded",
        error_code: null,
        prompt_version: SUMMARY_PROMPT_VERSION,
        model_id: MODEL_ID,
        bounded_input_snapshot: { movieId, reviewsRevision: REVISION, eligibleCount: 5, sample },
      }),
    ]);
    expect(JSON.stringify(await jobs())).not.toContain("synthetic opinion");

    const after = await movie(movieId);
    expect(after).toMatchObject({
      reviews_revision: REVISION,
      summary_pending_since: null,
      summary_last_success_at: expect.any(Date),
      // Generation never writes the attempt columns (D-89).
      summary_last_attempt_at: null,
      summary_next_attempt_at: null,
    });
  });

  it("calls the provider with no transaction open, and leaves none open (AI-03)", async () => {
    const { movieId } = await seedMovieWithReviews(3);
    const h = harness();

    await expect(h.generation.generate(movieId)).resolves.toMatchObject({ kind: "published" });

    expect(h.openDuringCall).toEqual([0]);
    expect(h.database.openTransactions).toBe(0);
  });

  it("publishes with the runtime's own summaryLimits and the marker fake, as the composition root wires it", async () => {
    const { movieId } = await seedMovieWithReviews(4);
    const settings: AiSettings = {
      provider: "fake",
      soc: { baseUrl: "https://fake-llm.invalid", apiKey: "synthetic-placeholder-key", model: MODEL_ID },
      quotas: { requestsPerMinute: 1_000 },
      budget: { dailyMicrodollars: 50_000_000, inputPriceMicrodollarsPerMTok: 1, outputPriceMicrodollarsPerMTok: 1 },
      execution: {
        maxConcurrentRequests: 1,
        attemptTimeoutMs: 30_000,
        maxAttempts: 2,
        executionDeadlineMs: 75_000,
        inputTokenLimit: 8_000,
      },
      summaries: { sampleSize: 3, intervalDays: 1, maxMoviesPerRun: 1 },
      moderation: { maxExecutions: 3, recoveryMaxReviews: 1 },
    };
    const runtime = createAiRuntime({
      ai: { enabled: true, value: settings },
      platform: {
        database: app,
        rateLimiter: createRateLimiter({ database: app, sql: app }),
        rateLimitKeys: createRateLimitKeys({ secret: "synthetic-rate-limit-key-secret-0123456789" }),
        appEnv: "test",
      },
      fetch: () => Promise.reject(new Error("the marker fake makes no request")),
    });
    expect(runtime.summaryLimits).toEqual({ sampleSize: 3, inputTokenLimit: 8_000 });
    const generation = createSummaryGeneration({
      preparation: createSummaryInputPreparation({
        database: app,
        inputs: createSummaryInputRepository({ sql: app }),
        limits: runtime.summaryLimits!,
        seedSource: () => SEED,
      }),
      controller: runtime.controller,
      publisher: createSummaryPublisher({
        movieLocks: createMovieLocks({ sql: app }),
        schedule: createSummarySchedule({ sql: app }),
        summaries: createReviewSummaryRepository({ sql: app }),
      }),
    });

    await expect(generation.generate(movieId)).resolves.toMatchObject({ kind: "published" });
    const [row] = await summaries(movieId);
    expect(row?.sampled_review_ids_and_versions).toMatchObject({ sampledCount: 3, reviews: expect.any(Array) });
    expect((row?.sampled_review_ids_and_versions as { reviews: unknown[] }).reviews).toHaveLength(3);
    expect(row?.eligible_count).toBe(4);
  });
});

describe("summary generation before K10: no execution record (AI-01 item 3, D-88, D-93)", () => {
  async function expectNoExecutionRecord(): Promise<void> {
    expect(await count("ai_job")).toBe(0);
    expect(await count("ai_budget_reservation")).toBe(0);
  }

  it("returns insufficient_reviews for 2 eligible Reviews and creates nothing (AT-07)", async () => {
    const { movieId } = await seedMovieWithReviews(2);
    const before = await movie(movieId);

    await expect(harness().generation.generate(movieId)).resolves.toEqual({
      kind: "insufficient_reviews",
      eligibleCount: 2,
    });
    await expectNoExecutionRecord();
    await expectNothingPublished(movieId, before);
  });

  it("returns unavailable for an archived Movie and creates nothing", async () => {
    const { movieId } = await seedMovieWithReviews(4);
    await owner.query("UPDATE app.movie SET archived_at = now() WHERE id = $1", [movieId]);
    const before = await movie(movieId);

    await expect(harness().generation.generate(movieId)).resolves.toEqual({ kind: "unavailable" });
    await expectNoExecutionRecord();
    await expectNothingPublished(movieId, before);
  });

  it("returns current when a summary exists at the revision and prompt version, and creates nothing", async () => {
    const { movieId } = await seedMovieWithReviews(4);
    await insertExistingSummary(movieId, REVISION, SUMMARY_PROMPT_VERSION);
    const before = await movie(movieId);

    await expect(harness().generation.generate(movieId)).resolves.toEqual({ kind: "current" });
    expect(await count("ai_job")).toBe(1);
    expect(await count("ai_budget_reservation")).toBe(0);
    expect(await summaries(movieId)).toHaveLength(1);
    expect(await movie(movieId)).toEqual(before);
  });

  it("returns input_unfit when fewer than 3 Reviews fit, and creates nothing", async () => {
    const { movieId } = await seedMovieWithReviews(4);
    const before = await movie(movieId);

    await expect(
      harness({ summaryLimits: { sampleSize: 20, inputTokenLimit: 50 } }).generation.generate(movieId),
    ).resolves.toEqual({ kind: "input_unfit" });
    await expectNoExecutionRecord();
    await expectNothingPublished(movieId, before);
  });
});

describe("summary publication races roll back (AI-01 item 7, AT-08, AM-23, AM-25)", () => {
  it("is stale when a committed K7 review change advances the revision during the provider call", async () => {
    const { movieId } = await seedMovieWithReviews(4);
    const h = harness({ duringCall: () => markReviewsChangedElsewhere(movieId) });

    const outcome = await h.generation.generate(movieId);

    expect(outcome).toEqual({ kind: "stale", jobId: expect.any(String) });
    expect(await summaries(movieId)).toEqual([]);
    expect(await movie(movieId)).toMatchObject({
      reviews_revision: REVISION + 1,
      summary_pending_since: PENDING_SINCE,
      summary_last_success_at: null,
    });
    expect(await jobs()).toEqual([expect.objectContaining({ status: "stale", error_code: "publish_stale" })]);
  });

  it("is stale when the Movie is archived during the provider call, and writes nothing", async () => {
    const { movieId } = await seedMovieWithReviews(4);
    const h = harness({
      duringCall: async () => {
        await owner.query("UPDATE app.movie SET archived_at = now() WHERE id = $1", [movieId]);
      },
    });

    await expect(h.generation.generate(movieId)).resolves.toMatchObject({ kind: "stale" });

    expect(await summaries(movieId)).toEqual([]);
    expect(await movie(movieId)).toMatchObject({
      archived_at: expect.any(Date),
      summary_pending_since: PENDING_SINCE,
      summary_last_success_at: null,
    });
    expect(await jobs()).toEqual([expect.objectContaining({ status: "stale", error_code: "publish_stale" })]);
  });

  it("rolls back the inserted summary and the K7 publication when the lease is lost before the P-08 check", async () => {
    const { movieId } = await seedMovieWithReviews(4);
    const before = await movie(movieId);
    const h = harness({
      duringCall: async () => {
        await owner.query("UPDATE app.ai_job SET lease_until = clock_timestamp() - interval '1 second'");
      },
    });

    await expect(h.generation.generate(movieId)).resolves.toMatchObject({ kind: "stale" });

    // The publish callback inserted the row and cleared pending before the lease check; both rolled back.
    await expectNothingPublished(movieId, before);
    expect(await jobs()).toEqual([expect.objectContaining({ status: "stale", error_code: "lease_expired" })]);
  });

  it("is stale when another publication at the same revision and prompt version commits first (duplicate guard)", async () => {
    const { movieId } = await seedMovieWithReviews(4);
    let competitorJob = "";
    const h = harness({
      duringCall: async () => {
        competitorJob = await insertExistingSummary(movieId, REVISION, SUMMARY_PROMPT_VERSION);
      },
    });

    await expect(h.generation.generate(movieId)).resolves.toMatchObject({ kind: "stale" });

    expect((await summaries(movieId)).map(({ job_id }) => job_id)).toEqual([competitorJob]);
    expect(await movie(movieId)).toMatchObject({ summary_pending_since: PENDING_SINCE, summary_last_success_at: null });
  });

  it("does not treat a summary from an older prompt version as current: it generates and publishes (D-93)", async () => {
    const { movieId } = await seedMovieWithReviews(4);
    const retired = await insertExistingSummary(movieId, REVISION, "review-summary-prompt-v0");
    let racing = "";
    const h = harness({
      duringCall: async () => {
        racing = await insertExistingSummary(movieId, REVISION, "review-summary-prompt-v0");
      },
    });

    const outcome = await h.generation.generate(movieId);

    expect(outcome).toMatchObject({ kind: "published" });
    expect((await summaries(movieId)).map(({ job_id }) => job_id).sort()).toEqual(
      [retired, racing, (outcome as { jobId: string }).jobId].sort(),
    );
    expect(await movie(movieId)).toMatchObject({ summary_pending_since: null });
  });

  it("publishes once, then the next generation at the same revision is current", async () => {
    const { movieId } = await seedMovieWithReviews(4);

    await expect(harness().generation.generate(movieId)).resolves.toMatchObject({ kind: "published" });
    await expect(harness().generation.generate(movieId)).resolves.toEqual({ kind: "current" });

    expect(await summaries(movieId)).toHaveLength(1);
    expect(await count("ai_job")).toBe(1);
  });

  it("returns duplicate when a running job holds the same dedup key, and creates nothing (D-88)", async () => {
    const { movieId } = await seedMovieWithReviews(4);
    const dedupKey = JSON.stringify(["summary", movieId, REVISION, MODEL_ID, SUMMARY_PROMPT_VERSION]);
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO app.ai_job (type, trigger, subject_id, input_revision, dedup_key, status, lease_until, expires_at,
                               model_id, prompt_version, input_hash)
       VALUES ('summary', 'scheduler', $1, $2, $3, 'running', now() + interval '60 seconds', now() + interval '7 days',
               $4, $5, 'synthetic-hash')
       RETURNING id`,
      [movieId, REVISION, dedupKey, MODEL_ID, SUMMARY_PROMPT_VERSION],
    );
    const before = await movie(movieId);
    const h = harness();

    await expect(h.generation.generate(movieId)).resolves.toEqual({ kind: "duplicate", jobId: rows[0]!.id });

    expect(h.openDuringCall).toEqual([]);
    expect(await count("ai_job")).toBe(1);
    expect(await count("ai_budget_reservation")).toBe(0);
    await expectNothingPublished(movieId, before);
  });
});

describe("summary output validation through K10 (AI-01 item 6, AI-04, D-87)", () => {
  function output(overrides: Record<string, unknown>): string {
    return JSON.stringify({ ...VALID_OUTPUT, ...overrides });
  }

  it.each([
    ["not JSON", "fake-llm invalid output"],
    ["an extra field", output({ confidence: 1 })],
    ["a missing field", JSON.stringify({ overall: "Fine.", strengths: [], criticisms: [] })],
    ["an oversized overall", output({ overall: "a".repeat(801) })],
    ["an oversized item", output({ strengths: [{ text: "a".repeat(241), sources: ["R1"] }] })],
    ["four strengths", output({ strengths: Array.from({ length: 4 }, () => ({ text: "Good.", sources: ["R1"] })) })],
    ["an invented label", output({ criticisms: [{ text: "Slow.", sources: ["R4"] }] })],
    ["a duplicated source", output({ criticisms: [{ text: "Slow.", sources: ["R1", "R1"] }] })],
    ["no sources", output({ criticisms: [{ text: "Slow.", sources: [] }] })],
    ["a URL", output({ overall: "See https://example.test." })],
    ["markup", output({ overall: "<img src=x onerror=alert(1)>" })],
  ])("fails invalid_output for %s, publishing nothing", async (_label, content) => {
    const { movieId } = await seedMovieWithReviews(3);
    const before = await movie(movieId);

    const outcome = await harness({ provider: contentProvider(content) }).generation.generate(movieId);

    expect(outcome).toEqual({ kind: "failed", jobId: expect.any(String), cause: "invalid_output" });
    await expectNothingPublished(movieId, before);
    expect(await jobs()).toEqual([expect.objectContaining({ status: "failed", error_code: "invalid_output" })]);
  });

  it("fails invalid_output when output cites a raw Review ID instead of a label", async () => {
    const { movieId, reviewIds } = await seedMovieWithReviews(3);
    const before = await movie(movieId);
    const content = output({ strengths: [{ text: "Praised.", sources: [reviewIds[0]] }] });

    await expect(harness({ provider: contentProvider(content) }).generation.generate(movieId)).resolves.toMatchObject({
      kind: "failed",
      cause: "invalid_output",
    });
    await expectNothingPublished(movieId, before);
  });

  it("fails invalid_output when output cites a label that reduction removed", async () => {
    const body = `${"A long synthetic opinion. ".repeat(30)}`;
    const movieId = await seedMovie();
    await seedReviews(movieId, 5, body);
    // Every Review has the same body and rating, so any 3 give the same estimate.
    const threeFit = prepareSummaryInput(
      movieId,
      {
        reviewsRevision: REVISION as ReviewsRevision,
        hasCurrentSummary: false,
        reviews: Array.from({ length: 3 }, (_, index) => ({
          id: `30000000-0000-4000-8000-00000000000${index}` as ReviewId,
          version: 2 as RowVersion,
          contentRevision: 1 as ContentRevision,
          rating: 7,
          body,
        })),
      },
      { sampleSize: 20, inputTokenLimit: Number.MAX_SAFE_INTEGER },
      SEED,
    );
    if (threeFit.kind !== "ready") {
      throw new Error("expected ready");
    }
    const limit = threeFit.input.estimatedInputTokens;
    const before = await movie(movieId);
    const content = output({ strengths: [{ text: "Praised.", sources: ["R1", "R4"] }] });

    const outcome = await harness({
      provider: contentProvider(content),
      summaryLimits: { sampleSize: 20, inputTokenLimit: limit },
      controllerLimits: { inputTokenLimit: limit },
    }).generation.generate(movieId);

    expect(outcome).toMatchObject({ kind: "failed", cause: "invalid_output" });
    const [job] = await jobs();
    expect(job?.bounded_input_snapshot).toMatchObject({ sample: { sampledCount: 5 } });
    expect((job?.bounded_input_snapshot as { sample: { reviews: unknown[] } }).sample.reviews).toHaveLength(3);
    await expectNothingPublished(movieId, before);
  });

  it("accepts a fenced reply citing only included labels", async () => {
    const { movieId } = await seedMovieWithReviews(3);
    const content = "```json\n" + MARKER_FAKE_SUMMARY_OUTPUT + "\n```";

    await expect(harness({ provider: contentProvider(content) }).generation.generate(movieId)).resolves.toMatchObject({
      kind: "published",
    });
    expect((await summaries(movieId))[0]?.output_json).toEqual(VALID_OUTPUT);
  });
});

describe("summary provider failures publish nothing (AI-01, AT-20)", () => {
  it.each([
    ["rejected", { kind: "failed", cause: "provider_rejected" }, "provider_rejected"],
    ["unavailable", { kind: "failed", cause: "transient" }, "provider_unavailable"],
    ["timeout", { kind: "failed", cause: "transient" }, "provider_timeout"],
    ["rate_limited", { kind: "deferred", retryAfterSeconds: null }, "provider_rate_limited"],
  ])("returns the K10 outcome for %s and keeps the Movie pending", async (marker, expected, errorCode) => {
    const { movieId } = await seedMovieWithReviews(3, marker);
    const before = await movie(movieId);

    await expect(harness().generation.generate(movieId)).resolves.toMatchObject(expected);

    await expectNothingPublished(movieId, before);
    expect(await jobs()).toEqual([expect.objectContaining({ status: "failed", error_code: errorCode })]);
  });

  it("returns deferred without a job when the provider slot is held by another instance", async () => {
    const { movieId } = await seedMovieWithReviews(3);
    await owner.query(
      `INSERT INTO app.scheduler_lease (name, lease_token, lease_until)
       VALUES ('ai_execution', gen_random_uuid(), now() + interval '60 seconds')`,
    );
    const before = await movie(movieId);

    await expect(harness().generation.generate(movieId)).resolves.toMatchObject({ kind: "deferred" });

    expect(await count("ai_job")).toBe(0);
    await expectNothingPublished(movieId, before);
  });
});
