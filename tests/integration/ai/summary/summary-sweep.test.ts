import { randomBytes, randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { LlmProvider } from "../../../../src/server/adapters/soc-llm";
import {
  createMarkerFakeLlmProvider,
  MARKER_FAKE_SUMMARY_OUTPUT,
} from "../../../../src/server/adapters/soc-llm/marker-fake-provider";
import { createDatabase, type Database, type Sql } from "../../../../src/server/db";
import { createPublicMovieReadRepository } from "../../../../src/server/repositories/catalogue";
import {
  createReviewSummaryRepository,
  createSummaryInputRepository,
  createSummarySelectionRepository,
  type SummarySelectionRepository,
} from "../../../../src/server/repositories/summary";
import {
  createAiExecutionController,
  createSchedulerLeases,
  type AiExecutionLimits,
} from "../../../../src/server/services/ai/runtime";
import {
  createSummaryGeneration,
  createSummaryInputPreparation,
  createSummaryPublisher,
  createSummarySweep,
  SUMMARY_PROMPT_VERSION,
  type SummaryGeneration,
  type SummarySweep,
  type SummarySweepLogLine,
} from "../../../../src/server/services/ai/summary";
import { createMovieLocks, createSummarySchedule } from "../../../../src/server/services/catalogue";
import { createRateLimiter, createRateLimitKeys } from "../../../../src/server/services/rate-limit";
import type { MovieId, RequestId, Tx } from "../../../../src/server/shared";
import { createLoginRole, dropLoginRole } from "../../../setup/test-database.mjs";
import { createManualTime } from "../../../support/fakes/manual-time";
import { instrumentDatabase, type InstrumentedDatabase } from "../../../support/instrumented-database";
import { connectAsOwner } from "../../database/schema-fixtures";
import { testDatabaseUrl } from "../../database/test-database";

// The D-89 sweep (as amended by D-94 and D-98) against PostgreSQL: real K1, K7 and K10 leases and controller, and
// the marker fake. Review rows are synthetic stand-ins for U-02 (D-91); they are not evidence for real review writes.

// A per-file login role with exactly app_runtime's privileges (D-31, D-32). Generated per run; never recorded.
const RUNTIME_ROLE = `mp3_sweep_${randomBytes(4).toString("hex")}`;
const RUNTIME_PASSWORD = randomBytes(24).toString("hex");

const MODEL_ID = "fake-model";
const OLDER_PROMPT_VERSION = "review-summary-prompt-v0";
const REQUEST_ID = "50000000-0000-4000-8000-000000000021" as RequestId;
const DAY_MS = 86_400_000;
const SOC_REQUESTS_KEY = createRateLimitKeys({ secret: "synthetic-rate-limit-key-secret-0123456789" }).forEnvironment(
  "soc_requests",
);
const CONTROLLER_LIMITS: AiExecutionLimits = {
  maxAttempts: 2,
  attemptTimeoutMs: 30_000,
  executionDeadlineMs: 75_000,
  inputTokenLimit: 8_000,
  requestsPerMinute: 1_000,
  dailyBudgetMicrodollars: 50_000_000,
  prices: { inputMicrodollarsPerMTok: 411_810, outputMicrodollarsPerMTok: 1_456_571 },
};

let owner: Client;
/** Each pool holds one connection: `app` and `other` are two server instances. */
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

/** Schedule columns as offsets in seconds from the database `now()`; null leaves the column null. */
interface MovieSeed {
  readonly pendingSeconds?: number | null;
  readonly lastAttemptSeconds?: number | null;
  readonly nextAttemptSeconds?: number | null;
  readonly lastSuccessSeconds?: number | null;
  readonly archived?: boolean;
  readonly id?: string;
}

async function seedMovie(seed: MovieSeed = {}): Promise<MovieId> {
  const offset = (index: number) =>
    `CASE WHEN $${index}::double precision IS NULL THEN NULL ELSE now() + make_interval(secs => $${index}) END`;
  const { rows } = await owner.query<{ id: MovieId }>(
    `INSERT INTO app.movie (id, title, synopsis, director, reviews_revision, summary_pending_since,
                            summary_last_attempt_at, summary_next_attempt_at, summary_last_success_at, archived_at)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), 'Synthetic Movie', 'Synthetic synopsis.', '', 2,
             ${offset(2)}, ${offset(3)}, ${offset(4)}, ${offset(5)}, CASE WHEN $6 THEN now() END)
     RETURNING id`,
    [
      seed.id ?? null,
      seed.pendingSeconds === undefined ? -3_600 : seed.pendingSeconds,
      seed.lastAttemptSeconds ?? null,
      seed.nextAttemptSeconds ?? null,
      seed.lastSuccessSeconds ?? null,
      seed.archived ?? false,
    ],
  );
  return rows[0]!.id;
}

interface ReviewSeed {
  readonly moderationState?: "pending" | "flagged" | "cleared";
  readonly hidden?: boolean;
  readonly deleted?: boolean;
  readonly contentRevision?: number;
  readonly marker?: string;
}

/** Inserts `count` synthetic Reviews, each by a new synthetic account. */
async function seedReviews(movieId: MovieId, count: number, seed: ReviewSeed = {}): Promise<void> {
  await owner.query(
    `WITH authors AS (
       INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
       SELECT gen_random_uuid() || '@example.test', 'synthetic-hash', 'Synthetic', 'USER', 'active'
       FROM generate_series(1, $2::integer)
       RETURNING id
     )
     INSERT INTO app.review
       (movie_id, author_id, rating, body, moderation_state, hidden_at, deleted_at, content_revision, clearance_source)
     SELECT $1, id, 7, $3, $4, CASE WHEN $5 THEN now() END, CASE WHEN $6 THEN now() END, $7,
            CASE WHEN $4 = 'cleared' THEN 'ai' END
     FROM authors`,
    [
      movieId,
      count,
      `A synthetic opinion. [fake-llm:${seed.marker ?? "summary"}]`,
      seed.moderationState ?? "cleared",
      seed.hidden ?? false,
      seed.deleted ?? false,
      seed.contentRevision ?? 1,
    ],
  );
}

/** A succeeded summary job and its ReviewSummary at the Movie's revision, as an earlier generation wrote. */
async function insertSummary(movieId: MovieId, promptVersion: string): Promise<void> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app.ai_job (type, trigger, subject_id, input_revision, dedup_key, status, lease_until, expires_at,
                             model_id, prompt_version, input_hash)
     SELECT 'summary', 'scheduler', id, reviews_revision, $2, 'succeeded', now(), now() + interval '7 days', $3, $4,
            'synthetic-hash'
     FROM app.movie WHERE id = $1
     RETURNING id`,
    [movieId, randomUUID(), MODEL_ID, promptVersion],
  );
  await owner.query(
    `INSERT INTO app.review_summary
       (job_id, movie_id, reviews_revision, sampled_review_ids_and_versions, eligible_count, output_json, generated_at)
     SELECT $1, id, reviews_revision, '{}'::jsonb, 3, $2::jsonb, now() FROM app.movie WHERE id = $3`,
    [rows[0]!.id, MARKER_FAKE_SUMMARY_OUTPUT, movieId],
  );
}

interface ScheduleRow {
  readonly summary_pending_since: Date | null;
  readonly summary_next_attempt_at: Date | null;
  readonly summary_last_attempt_at: Date | null;
  readonly summary_last_success_at: Date | null;
}

async function schedule(movieId: MovieId): Promise<ScheduleRow> {
  const { rows } = await owner.query<ScheduleRow>(
    `SELECT summary_pending_since, summary_next_attempt_at, summary_last_attempt_at, summary_last_success_at
     FROM app.movie WHERE id = $1`,
    [movieId],
  );
  return rows[0]!;
}

async function count(table: "ai_job" | "review_summary"): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(`SELECT count(*)::integer AS n FROM app.${table}`);
  return rows[0]!.n;
}

/** Asserts step 1's backoff: the next attempt is one day after the recorded attempt (D-89, D-94 L4). */
function expectOneDayBackoff(row: ScheduleRow): void {
  const gap = row.summary_next_attempt_at!.getTime() - row.summary_last_attempt_at!.getTime();
  // `now()` round-trips through a millisecond JS Date, so the gap can be short by under a millisecond.
  expect(gap).toBeGreaterThan(DAY_MS - 1);
  expect(gap).toBeLessThanOrEqual(DAY_MS);
}

/** Runs as the least-privilege runtime role, as production does. */
function selectDue(intervalDays = 1, limit = 10): Promise<readonly MovieId[]> {
  return app.withTransaction((tx) =>
    createSummarySelectionRepository({ sql: app }).selectDue(tx, {
      promptVersion: SUMMARY_PROMPT_VERSION,
      intervalDays,
      limit,
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Harness

interface Harness {
  readonly sweep: SummarySweep;
  readonly database: InstrumentedDatabase;
  readonly logs: SummarySweepLogLine[];
  /** `database.openTransactions` at the start of each provider call. */
  readonly openDuringCall: number[];
}

function harness(
  options: {
    readonly database?: Database & Sql;
    readonly provider?: LlmProvider;
    readonly duringCall?: () => Promise<void>;
    readonly selection?: (inner: SummarySelectionRepository) => SummarySelectionRepository;
    readonly generation?: (inner: SummaryGeneration) => SummaryGeneration;
    readonly intervalDays?: number;
  } = {},
): Harness {
  const database = instrumentDatabase(options.database ?? app);
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
  const movieLocks = createMovieLocks({ sql: database });
  const summarySchedule = createSummarySchedule({ sql: database });
  const generation = createSummaryGeneration({
    preparation: createSummaryInputPreparation({
      database,
      inputs: createSummaryInputRepository({ sql: database }),
      limits: { sampleSize: 20, inputTokenLimit: 8_000 },
      seedSource: () => Buffer.alloc(32, 0x5a),
    }),
    controller: createAiExecutionController({
      database,
      sql: database,
      rateLimiter: createRateLimiter({ database, sql: database }),
      socRequestKey: SOC_REQUESTS_KEY,
      provider,
      limits: CONTROLLER_LIMITS,
      ...(() => {
        // A hook does real I/O during the call; an auto-advancing clock would fire the attempt timeout meanwhile.
        const time = createManualTime({ autoAdvance: options.duringCall === undefined });
        return { random: time.random, clock: time.clock, sleep: time.sleep };
      })(),
    }),
    publisher: createSummaryPublisher({
      movieLocks,
      schedule: summarySchedule,
      summaries: createReviewSummaryRepository({ sql: database }),
    }),
  });
  const selection = createSummarySelectionRepository({ sql: database });
  const logs: SummarySweepLogLine[] = [];
  const sweep = createSummarySweep({
    database,
    leases: createSchedulerLeases({ database, sql: database }),
    selection: options.selection?.(selection) ?? selection,
    movieLocks,
    schedule: summarySchedule,
    generation: options.generation?.(generation) ?? generation,
    limits: { intervalDays: options.intervalDays ?? 1, maxMoviesPerRun: 1 },
    log: { record: (line) => logs.push(line) },
  });
  return { sweep, database, logs, openDuringCall };
}

const ZERO = { processed: 0, skipped: 0, deferred: 0, failed: 0 };

// ---------------------------------------------------------------------------------------------------------

describe("summary sweep selection (D-89, D-94, D-98)", () => {
  it("orders never-attempted first, then oldest last attempt, then oldest pending time, then id", async () => {
    const attemptedLater = await seedMovie({ lastAttemptSeconds: -3 * 86_400 + 600, nextAttemptSeconds: -600 });
    const attemptedEarlier = await seedMovie({ lastAttemptSeconds: -3 * 86_400, nextAttemptSeconds: -600 });
    const neverNewerPending = await seedMovie({ pendingSeconds: -60 });
    const neverOlderPendingHighId = await seedMovie({ pendingSeconds: -7_200, id: "ffffffff-0000-4000-8000-000000000001" });
    const neverOlderPendingLowId = await seedMovie({ pendingSeconds: -7_200, id: "00000000-0000-4000-8000-000000000001" });
    for (const movieId of [attemptedLater, attemptedEarlier, neverNewerPending, neverOlderPendingHighId, neverOlderPendingLowId]) {
      await seedReviews(movieId, 3);
    }
    // Pin equal pending times for the id tie-break.
    await owner.query(
      "UPDATE app.movie SET summary_pending_since = '2026-01-01T00:00:00Z' WHERE id = ANY($1::uuid[])",
      [[neverOlderPendingHighId, neverOlderPendingLowId]],
    );

    expect(await selectDue()).toEqual([
      neverOlderPendingLowId,
      neverOlderPendingHighId,
      neverNewerPending,
      attemptedEarlier,
      attemptedLater,
    ]);
    expect(await selectDue(1, 1)).toEqual([neverOlderPendingLowId]);
  });

  it("never selects a Movie with fewer than 3 eligible Reviews, whatever its other Reviews' states", async () => {
    const twoEligible = await seedMovie({ pendingSeconds: -86_400 });
    await seedReviews(twoEligible, 2);
    await seedReviews(twoEligible, 1, { moderationState: "pending" });
    await seedReviews(twoEligible, 1, { moderationState: "flagged" });
    await seedReviews(twoEligible, 1, { hidden: true });
    await seedReviews(twoEligible, 1, { deleted: true });
    const threeEligible = await seedMovie({ pendingSeconds: -60 });
    await seedReviews(threeEligible, 2);
    await seedReviews(threeEligible, 1, { contentRevision: 3 });

    expect(await selectDue()).toEqual([threeEligible]);
  });

  it("counts eligibility exactly as the U-01 public reviewCount and the D-86 read (D-94 M3 parity)", async () => {
    const movieId = await seedMovie();
    // Distinct counts per state, so a wrongly included or excluded state cannot cancel out (D-93). Only 2 are
    // eligible, so the selection threshold of 3 is crossed exactly when a non-eligible state is counted.
    await seedReviews(movieId, 2);
    await seedReviews(movieId, 1, { moderationState: "pending" });
    await seedReviews(movieId, 2, { moderationState: "flagged" });
    await seedReviews(movieId, 4, { hidden: true });
    await seedReviews(movieId, 8, { deleted: true });
    await seedReviews(movieId, 16, { hidden: true, deleted: true });

    const [detail, snapshot] = await app.withTransaction(async (tx: Tx) => [
      await createPublicMovieReadRepository({ sql: app }).findActiveById(tx, movieId),
      await createSummaryInputRepository({ sql: app }).readSnapshot(tx, movieId, SUMMARY_PROMPT_VERSION),
    ] as const);
    expect(detail?.reviewCount).toBe(2);
    expect(snapshot?.reviews).toHaveLength(2);
    expect(await selectDue()).toEqual([]);

    await seedReviews(movieId, 1, { contentRevision: 2 });
    expect(await selectDue()).toEqual([movieId]);
  });

  it("does not select an archived Movie", async () => {
    const movieId = await seedMovie({ archived: true });
    await seedReviews(movieId, 3);
    expect(await selectDue()).toEqual([]);
  });

  it("allows one hour of cron timing tolerance on the next attempt (D-94 M5)", async () => {
    const withinHour = await seedMovie({ nextAttemptSeconds: 59 * 60 });
    const pastHour = await seedMovie({ nextAttemptSeconds: 61 * 60 });
    await seedReviews(withinHour, 3);
    await seedReviews(pastHour, 3);
    expect(await selectDue()).toEqual([withinHour]);
  });

  it("applies the daily interval with one hour of tolerance to the last success", async () => {
    const dueEarly = await seedMovie({ lastSuccessSeconds: -86_400 + 30 * 60 });
    const tooRecent = await seedMovie({ lastSuccessSeconds: -86_400 + 61 * 60 });
    await seedReviews(dueEarly, 3);
    await seedReviews(tooRecent, 3);
    expect(await selectDue(1)).toEqual([dueEarly]);
  });

  it("applies the weekly interval (AI_SUMMARY_INTERVAL_DAYS = 7)", async () => {
    const twoDaysAgo = await seedMovie({ lastSuccessSeconds: -2 * 86_400 });
    const weekAgo = await seedMovie({ lastSuccessSeconds: -7 * 86_400 + 30 * 60 });
    await seedReviews(twoDaysAgo, 3);
    await seedReviews(weekAgo, 3);
    expect(await selectDue(7)).toEqual([weekAgo]);
    expect([...(await selectDue(1))].sort()).toEqual([weekAgo, twoDaysAgo].sort());
  });

  it("skips an unchanged Movie, and selects a retired summary only when no current one exists (D-93, D-94)", async () => {
    const unchanged = await seedMovie({ pendingSeconds: null });
    await insertSummary(unchanged, SUMMARY_PROMPT_VERSION);
    const neverSummarised = await seedMovie({ pendingSeconds: null });
    const retired = await seedMovie({ pendingSeconds: null });
    await insertSummary(retired, OLDER_PROMPT_VERSION);
    const retiredAndCurrent = await seedMovie({ pendingSeconds: null });
    await insertSummary(retiredAndCurrent, OLDER_PROMPT_VERSION);
    await insertSummary(retiredAndCurrent, SUMMARY_PROMPT_VERSION);
    const retiredAtOlderRevision = await seedMovie({ pendingSeconds: null });
    await insertSummary(retiredAtOlderRevision, OLDER_PROMPT_VERSION);
    await owner.query("UPDATE app.movie SET reviews_revision = reviews_revision + 1 WHERE id = $1", [retiredAtOlderRevision]);
    for (const movieId of [unchanged, neverSummarised, retired, retiredAndCurrent, retiredAtOlderRevision]) {
      await seedReviews(movieId, 3);
    }

    expect(await selectDue()).toEqual([retired]);
  });

  it("puts a pending change before a retired summary when neither has been attempted (D-98)", async () => {
    const retired = await seedMovie({ pendingSeconds: null, id: "00000000-0000-4000-8000-000000000002" });
    await insertSummary(retired, OLDER_PROMPT_VERSION);
    const pending = await seedMovie({ pendingSeconds: -60, id: "ffffffff-0000-4000-8000-000000000002" });
    await seedReviews(retired, 3);
    await seedReviews(pending, 3);
    expect(await selectDue()).toEqual([pending, retired]);
  });

  it("reads the schedule clock from the database, one day apart", async () => {
    const clock = await app.withTransaction((tx) => createSummarySelectionRepository({ sql: app }).readScheduleClock(tx));
    expect(clock.oneDayLater.getTime() - clock.now.getTime()).toBe(DAY_MS);
    expect(Math.abs(clock.now.getTime() - Date.now())).toBeLessThan(60_000);
  });
});

describe("summary sweep against PostgreSQL (D-89, D-94, AT-07, AT-20)", () => {
  it("publishes the due Movie, records the attempt with a one-day backoff and clears pending", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 4);
    const h = harness();

    await expect(h.sweep.run(REQUEST_ID)).resolves.toEqual({ ok: true, value: { ...ZERO, processed: 1 } });

    const row = await schedule(movieId);
    expect(row.summary_pending_since).toBeNull();
    expect(row.summary_last_success_at).not.toBeNull();
    expectOneDayBackoff(row);
    expect(await count("review_summary")).toBe(1);
    expect(h.openDuringCall).toEqual([0]);
    expect(h.logs).toMatchObject([{ outcome: "completed", movieId, outcomeKind: "published" }]);
    expect(h.logs[0]?.jobId).toEqual(expect.any(String));

    // Unchanged content is not regenerated merely because time passed (AI-01).
    await owner.query("UPDATE app.movie SET summary_next_attempt_at = now() - interval '1 day', summary_last_success_at = now() - interval '8 days' WHERE id = $1", [movieId]);
    await expect(harness().sweep.run(REQUEST_ID)).resolves.toEqual({ ok: true, value: ZERO });
    expect(await count("ai_job")).toBe(1);
  });

  it("returns zero counts with no writes when nothing is due", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 2);
    const before = await schedule(movieId);

    await expect(harness().sweep.run(REQUEST_ID)).resolves.toEqual({ ok: true, value: ZERO });
    expect(await schedule(movieId)).toEqual(before);
    expect(await count("ai_job")).toBe(0);
  });

  it("returns zero counts while another run holds the summary_sweep lease", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 3);
    const token = randomUUID();
    await owner.query(
      "INSERT INTO app.scheduler_lease (name, lease_token, lease_until) VALUES ('summary_sweep', $1, now() + interval '1 minute')",
      [token],
    );
    const h = harness();

    await expect(h.sweep.run(REQUEST_ID)).resolves.toEqual({ ok: true, value: ZERO });
    expect(h.logs).toMatchObject([{ outcome: "lease_held" }]);
    expect(await count("ai_job")).toBe(0);
    const { rows } = await owner.query("SELECT lease_token FROM app.scheduler_lease WHERE name = 'summary_sweep'");
    expect(rows).toEqual([{ lease_token: token }]);
  });

  it("lets only one of two overlapping sweeps on different instances generate (AT-07)", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 3);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = harness({ duringCall: () => held });
    const second = harness({ database: other });

    const running = first.sweep.run(REQUEST_ID);
    // Wait until the first sweep is inside the provider call, holding the lease.
    await vi.waitFor(() => expect(first.openDuringCall).toHaveLength(1));
    await expect(second.sweep.run(REQUEST_ID)).resolves.toEqual({ ok: true, value: ZERO });
    expect(second.logs).toMatchObject([{ outcome: "lease_held" }]);
    release();
    await expect(running).resolves.toEqual({ ok: true, value: { ...ZERO, processed: 1 } });
    expect(await count("ai_job")).toBe(1);
  });

  it("gives a failed Movie the one-day backoff and processes another pending Movie next (AT-20 fairness)", async () => {
    const failing = await seedMovie({ pendingSeconds: -7_200 });
    await seedReviews(failing, 3, { marker: "invalid" });
    const waiting = await seedMovie({ pendingSeconds: -60 });
    await seedReviews(waiting, 3);

    await expect(harness().sweep.run(REQUEST_ID)).resolves.toEqual({ ok: true, value: { ...ZERO, failed: 1 } });
    const failed = await schedule(failing);
    expect(failed.summary_pending_since).not.toBeNull();
    expectOneDayBackoff(failed);
    expect(await count("review_summary")).toBe(0);

    // The next run the same day takes the other Movie; a new change to the failing one does not bypass backoff.
    await owner.query("UPDATE app.movie SET reviews_revision = reviews_revision + 1 WHERE id = $1", [failing]);
    await expect(harness().sweep.run(REQUEST_ID)).resolves.toEqual({ ok: true, value: { ...ZERO, processed: 1 } });
    expect((await schedule(waiting)).summary_pending_since).toBeNull();
    expect(await selectDue()).toEqual([]);

    // A missed run: once the backoff has passed, the failing Movie is selected again without a new change.
    await owner.query("UPDATE app.movie SET summary_next_attempt_at = now() - interval '2 days' WHERE id = $1", [failing]);
    expect(await selectDue()).toEqual([failing]);
  });

  it("keeps pending and retries from now after a provider rate limit, without a new change (AT-20 deferral)", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 3, { marker: "rate_limited" });

    await expect(harness().sweep.run(REQUEST_ID)).resolves.toEqual({ ok: true, value: { ...ZERO, deferred: 1 } });
    const row = await schedule(movieId);
    expect(row.summary_pending_since).not.toBeNull();
    expect(row.summary_next_attempt_at!.getTime()).toBeGreaterThanOrEqual(row.summary_last_attempt_at!.getTime());
    expect(row.summary_next_attempt_at!.getTime() - row.summary_last_attempt_at!.getTime()).toBeLessThan(60_000);
    expect(await selectDue()).toEqual([movieId]);
  });

  it("counts a generation that throws as failed, keeps the backoff and returns its counts (D-94 M8, crash recovery)", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 3);
    const h = harness({ generation: () => ({ generate: () => Promise.reject(new Error("instance crashed")) }) });

    await expect(h.sweep.run(REQUEST_ID)).resolves.toEqual({ ok: true, value: { ...ZERO, failed: 1 } });
    const row = await schedule(movieId);
    expect(row.summary_pending_since).not.toBeNull();
    expectOneDayBackoff(row);
  });

  it("counts a Movie archived between selection and step 1 as skipped and writes nothing", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 3);
    const before = await schedule(movieId);
    const h = harness({
      selection: (inner) => ({
        ...inner,
        async selectDue(tx, criteria) {
          const due = await inner.selectDue(tx, criteria);
          await owner.query("UPDATE app.movie SET archived_at = now() WHERE id = $1", [movieId]);
          return due;
        },
      }),
    });

    await expect(h.sweep.run(REQUEST_ID)).resolves.toEqual({ ok: true, value: { ...ZERO, skipped: 1 } });
    expect(await schedule(movieId)).toEqual(before);
    expect(await count("ai_job")).toBe(0);
  });

  it("is unavailable, writing nothing, when selection fails", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 3);
    const before = await schedule(movieId);
    const h = harness({
      selection: (inner) => ({
        ...inner,
        selectDue: (tx) => h.database.query(tx, "SELECT * FROM app.no_such_table", []).then(() => []),
      }),
    });

    await expect(h.sweep.run(REQUEST_ID)).resolves.toEqual({ ok: false, error: { kind: "unavailable" } });
    expect(h.logs).toMatchObject([{ outcome: "unavailable", phase: "selection" }]);
    expect(await schedule(movieId)).toEqual(before);
    // The lease is released, so the next run is not blocked.
    const { rows } = await owner.query("SELECT lease_until <= clock_timestamp() AS released FROM app.scheduler_lease");
    expect(rows).toEqual([{ released: true }]);
  });
});
