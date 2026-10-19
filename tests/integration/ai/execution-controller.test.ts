import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { LlmCompletion, LlmFailure, LlmProvider } from "../../../src/server/adapters/soc-llm";
import {
  createFakeLlmProvider,
  type FakeLlmOutcome,
  type FakeLlmProvider,
} from "../../../src/server/adapters/soc-llm/fake-llm-provider";
import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import {
  createAiExecutionController,
  type AiExecutionController,
  type AiExecutionLimits,
  type AiExecutionRequest,
  type AiJobDescriptor,
} from "../../../src/server/services/ai/runtime";
import {
  createRateLimiter,
  createRateLimitKeys,
  type RateLimiter,
  type RateLimitOutcome,
} from "../../../src/server/services/rate-limit";
import type {
  AccountId,
  ContentRevision,
  MovieId,
  ReviewId,
  ReviewsRevision,
  RowVersion,
} from "../../../src/server/shared";
import { createLoginRole, dropLoginRole } from "../../setup/test-database.mjs";
import { createManualTime, type ManualTime } from "../../support/fakes/manual-time";
import { instrumentDatabase, type InstrumentedDatabase } from "../../support/instrumented-database";
import { connectAsOwner, insertAccount } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";

// A per-file login role that inherits exactly app_runtime's privileges (D-31, D-32), so every K10 statement
// runs with production's table privileges. Generated per run; never recorded.
const RUNTIME_ROLE = `mp3_ai_runtime_${randomBytes(4).toString("hex")}`;
const RUNTIME_PASSWORD = randomBytes(24).toString("hex");

const MODEL_ID = "fake-model";
const SOC_REQUESTS_KEY = createRateLimitKeys({ secret: "synthetic-rate-limit-key-secret-0123456789" }).forEnvironment(
  "soc_requests",
);

const LIMITS: AiExecutionLimits = {
  maxAttempts: 2,
  attemptTimeoutMs: 30_000,
  executionDeadlineMs: 75_000,
  inputTokenLimit: 8_000,
  requestsPerMinute: 1_000,
  dailyBudgetMicrodollars: 50_000_000,
  // The D-48 verified prices, as synthetic inputs.
  prices: { inputMicrodollarsPerMTok: 411_810, outputMicrodollarsPerMTok: 1_456_571 },
};

// "sys" + "user text" is 12 UTF-8 bytes in 2 messages: ceil(12 ÷ 3) + 32 = 36 estimated input tokens.
const MESSAGES = [
  { role: "system", content: "sys" },
  { role: "user", content: "user text" },
] as const;
/** R = ceil((36 × 411,810 + 1,000 × 1,456,571) ÷ 10^6) = ceil(1,471.396) at maxOutputTokens 1,000. */
const R = 1_472;
const USAGE = { inputTokens: 100, outputTokens: 50 };
/** ceil((100 × 411,810 + 50 × 1,456,571) ÷ 10^6) = ceil(114.00955). */
const USAGE_COST = 115;

const SNAPSHOT = { reviewIds: ["synthetic"], truncated: false, nested: { count: 3 } };

let owner: Client;
/** Two pools of one connection each: two server instances competing for the same rows. */
let first: Database & Sql;
let second: Database & Sql;

function runtimeUrl(): string {
  const url = new URL(testDatabaseUrl());
  url.username = RUNTIME_ROLE;
  url.password = RUNTIME_PASSWORD;
  return url.href;
}

beforeAll(async () => {
  owner = await connectAsOwner();
  await createLoginRole(owner, RUNTIME_ROLE, RUNTIME_PASSWORD);
  first = createDatabase({ url: runtimeUrl(), caCert: null });
  second = createDatabase({ url: runtimeUrl(), caCert: null });
});

afterAll(async () => {
  // The pools have no close operation, so end their sessions before dropping the role.
  await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1", [RUNTIME_ROLE]);
  await dropLoginRole(owner, RUNTIME_ROLE);
  await owner.end();
});

beforeEach(async () => {
  await owner.query(
    `TRUNCATE app.ai_budget_reservation, app.ai_job, app.ai_budget_day, app.scheduler_lease,
       app.rate_limit_window, app.audit_entry CASCADE`,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------------
// Building controllers and requests

interface Harness {
  readonly controller: AiExecutionController;
  readonly database: InstrumentedDatabase;
  readonly time: ManualTime;
}

function harness(options: {
  readonly provider: LlmProvider;
  readonly database?: Database & Sql;
  readonly limits?: Partial<AiExecutionLimits>;
  readonly time?: ManualTime;
  readonly rateLimiter?: (inner: RateLimiter) => RateLimiter;
}): Harness {
  const database = instrumentDatabase(options.database ?? first);
  const time = options.time ?? createManualTime();
  const limiter = createRateLimiter({ database, sql: database });
  const controller = createAiExecutionController({
    database,
    sql: database,
    rateLimiter: options.rateLimiter === undefined ? limiter : options.rateLimiter(limiter),
    socRequestKey: SOC_REQUESTS_KEY,
    provider: options.provider,
    limits: { ...LIMITS, ...options.limits },
    random: time.random,
    clock: time.clock,
    sleep: time.sleep,
  });
  return { controller, database, time };
}

function fake(...script: FakeLlmOutcome[]): FakeLlmProvider {
  return createFakeLlmProvider({ modelId: MODEL_ID, script });
}

const success = (content = "ok:summary", usage: LlmCompletion["usage"] = USAGE): FakeLlmOutcome => ({
  kind: "success",
  content,
  usage,
});
const fail = (failure: LlmFailure): FakeLlmOutcome => ({ kind: "failure", failure });
const HANG: FakeLlmOutcome = { kind: "hang" };

function summaryJob(): AiJobDescriptor {
  return {
    type: "summary",
    movieId: randomUUID() as MovieId,
    reviewsRevision: 4 as ReviewsRevision,
    promptVersion: "summary-prompt-v1",
  };
}

type Publish = AiExecutionRequest<string>["publish"];
type Validate = AiExecutionRequest<string>["validate"];

/** Records the publish as an AuditEntry in the publish Tx, so a test can tell whether that Tx committed. */
function recordingPublish(sql: Sql): Publish {
  return async (tx, _output, job) => {
    await sql.query(
      tx,
      `INSERT INTO app.audit_entry (actor_id, action, target_type, target_id, result, request_id)
       VALUES (NULL, 'test.publish', 'ai_job', $1, 'applied', 'synthetic-request')`,
      [job.jobId],
    );
    return { ok: true, value: undefined };
  };
}

const parseOk: Validate = (content) =>
  content.startsWith("ok:") ? { ok: true, value: content.slice(3) } : { ok: false, error: { kind: "invalid_output" } };

function request(
  overrides: Partial<Omit<AiExecutionRequest<string>, "input">> & { readonly input?: Partial<AiExecutionRequest<string>["input"]> } = {},
): AiExecutionRequest<string> {
  return {
    job: overrides.job ?? summaryJob(),
    input: { messages: MESSAGES, estimatedInputTokens: 1, snapshot: SNAPSHOT, ...overrides.input },
    maxOutputTokens: overrides.maxOutputTokens ?? 1_000,
    validate: overrides.validate ?? parseOk,
    publish: overrides.publish ?? recordingPublish(first),
  };
}

/** A rate limiter whose `consume` calls go through `intercept`, numbered from 1. */
function interceptConsume(
  intercept: (call: number, consume: () => Promise<RateLimitOutcome>) => Promise<RateLimitOutcome>,
): (inner: RateLimiter) => RateLimiter {
  return (inner) => {
    let calls = 0;
    return {
      ...inner,
      consume(key, policy, units) {
        calls += 1;
        return intercept(calls, () => inner.consume(key, policy, units));
      },
    };
  };
}

/** Wraps a provider to observe each call before it is forwarded. */
function observed(provider: LlmProvider, onCall: () => void): LlmProvider {
  return {
    modelId: provider.modelId,
    complete(request) {
      onCall();
      return provider.complete(request);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Reading state as the owner. bigint and date are cast so the owner's default parsers return plain values.

interface JobRow {
  id: string;
  type: string;
  trigger: string;
  requester_id: string | null;
  subject_id: string;
  input_revision: number;
  dedup_key: string;
  status: string;
  attempt_count: number;
  model_id: string;
  prompt_version: string;
  policy_version: string | null;
  input_hash: string;
  bounded_input_snapshot: unknown;
  error_code: string | null;
  lease_seconds: number;
  expires_after_seconds: number;
}

async function jobs(): Promise<JobRow[]> {
  const { rows } = await owner.query<JobRow>(
    `SELECT id, type, trigger, requester_id, subject_id, input_revision, dedup_key, status, attempt_count, model_id,
       prompt_version, policy_version, input_hash, bounded_input_snapshot, error_code,
       extract(epoch FROM lease_until - created_at)::float AS lease_seconds,
       extract(epoch FROM expires_at - created_at)::float AS expires_after_seconds
     FROM app.ai_job ORDER BY created_at, id`,
  );
  return rows;
}

async function onlyJob(): Promise<JobRow> {
  const all = await jobs();
  expect(all).toHaveLength(1);
  return all[0]!;
}

interface ReservationRow {
  ai_job_id: string;
  budget_day: string;
  reserved_microdollars: number;
  input_tokens: number | null;
  output_tokens: number | null;
  actual_microdollars: number | null;
  status: string;
  reconciled: boolean;
}

async function reservations(): Promise<ReservationRow[]> {
  const { rows } = await owner.query<ReservationRow>(
    `SELECT ai_job_id, budget_day::text AS budget_day, reserved_microdollars::float AS reserved_microdollars,
       input_tokens, output_tokens, actual_microdollars::float AS actual_microdollars, status,
       reconciled_at IS NOT NULL AS reconciled
     FROM app.ai_budget_reservation ORDER BY created_at, id`,
  );
  return rows;
}

async function onlyReservation(): Promise<ReservationRow> {
  const all = await reservations();
  expect(all).toHaveLength(1);
  return all[0]!;
}

interface DayRow {
  budget: number;
  reserved: number;
  consumed: number;
}

const TODAY = "(now() AT TIME ZONE 'UTC')::date";

async function day(offsetDays = 0): Promise<DayRow | null> {
  const { rows } = await owner.query<DayRow>(
    `SELECT budget_microdollars::float AS budget, reserved_microdollars::float AS reserved,
       consumed_microdollars::float AS consumed
     FROM app.ai_budget_day WHERE budget_day = ${TODAY} + $1::integer`,
    [offsetDays],
  );
  return rows[0] ?? null;
}

async function lease(): Promise<{ held: boolean; token: string } | null> {
  const { rows } = await owner.query<{ held: boolean; token: string }>(
    "SELECT lease_until > clock_timestamp() AS held, lease_token::text AS token FROM app.scheduler_lease WHERE name = 'ai_execution'",
  );
  return rows[0] ?? null;
}

async function quotaUnits(): Promise<number> {
  const { rows } = await owner.query<{ units: number }>(
    "SELECT coalesce(sum(count), 0)::integer AS units FROM app.rate_limit_window WHERE bucket_key = $1",
    [SOC_REQUESTS_KEY],
  );
  return rows[0]!.units;
}

async function publishedRows(): Promise<number> {
  const { rows } = await owner.query<{ n: number }>("SELECT count(*)::integer AS n FROM app.audit_entry");
  return rows[0]!.n;
}

async function secondsToNextUtcDay(): Promise<number> {
  const { rows } = await owner.query<{ s: number }>(
    `SELECT ceil(extract(epoch FROM ((${TODAY} + 1)::timestamp AT TIME ZONE 'UTC') - now()))::integer AS s`,
  );
  return rows[0]!.s;
}

/** Nothing at all was written: no quota unit, lease, budget day, job or reservation. */
async function expectNoWrites(): Promise<void> {
  expect(await quotaUnits()).toBe(0);
  expect(await lease()).toBeNull();
  expect(await day()).toBeNull();
  expect(await jobs()).toEqual([]);
  expect(await reservations()).toEqual([]);
}

/** After a run that reached step 1: the slot is free, and today's day holds no reservation. */
async function expectSettled(consumed: number): Promise<void> {
  expect(await lease()).toMatchObject({ held: false });
  expect(await day()).toMatchObject({ reserved: 0, consumed });
}

// Seeding abandoned work as the owner.

async function seedDay(offsetDays: number, budget: number, reserved: number, consumed: number): Promise<void> {
  await owner.query(
    `INSERT INTO app.ai_budget_day (budget_day, budget_microdollars, reserved_microdollars, consumed_microdollars)
     VALUES (${TODAY} + $1::integer, $2, $3, $4)`,
    [offsetDays, budget, reserved, consumed],
  );
}

async function seedJob(options: {
  readonly status: "running" | "succeeded";
  readonly leaseFromNow: string;
  readonly dedupKey?: string;
}): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app.ai_job (type, trigger, subject_id, input_revision, dedup_key, status, lease_until, expires_at,
       model_id, prompt_version, input_hash)
     VALUES ('summary', 'scheduler', $1, 0, $2, $3, now() + $4::interval, now() + interval '7 days',
       'fake-model', 'summary-prompt-v1', 'synthetic-hash')
     RETURNING id`,
    [randomUUID(), options.dedupKey ?? randomUUID(), options.status, options.leaseFromNow],
  );
  return rows[0]!.id;
}

async function seedReservation(jobId: string, offsetDays: number, reserved: number): Promise<void> {
  await owner.query(
    `INSERT INTO app.ai_budget_reservation (ai_job_id, budget_day, reserved_microdollars, status)
     VALUES ($1, ${TODAY} + $2::integer, $3, 'reserved')`,
    [jobId, offsetDays, reserved],
  );
}

async function seedHeldLease(secondsFromNow: number): Promise<string> {
  const { rows } = await owner.query<{ token: string }>(
    `INSERT INTO app.scheduler_lease (name, lease_token, lease_until)
     VALUES ('ai_execution', gen_random_uuid(), now() + make_interval(secs => $1))
     ON CONFLICT (name) DO UPDATE SET lease_token = EXCLUDED.lease_token, lease_until = EXCLUDED.lease_until
     RETURNING lease_token::text AS token`,
    [secondsFromNow],
  );
  return rows[0]!.token;
}

// ---------------------------------------------------------------------------------------------------------

describe("AiExecutionController.run — publication (contracts §13, D-64, D-73)", () => {
  it("publishes, writes the D-64 columns and reconciles from reported usage", async () => {
    const provider = fake(success());
    const validate = vi.fn(parseOk);
    const publish = vi.fn(recordingPublish(first));
    const job = summaryJob();
    const { controller } = harness({ provider });

    const outcome = await controller.run(request({ job, validate, publish }));

    const stored = await onlyJob();
    expect(outcome).toEqual({ kind: "published", jobId: stored.id });
    expect(validate).toHaveBeenCalledExactlyOnceWith("ok:summary");
    expect(publish).toHaveBeenCalledExactlyOnceWith(expect.anything(), "summary", { jobId: stored.id });
    expect(provider.requests).toEqual([{ messages: MESSAGES, maxOutputTokens: 1_000 }]);
    expect(await publishedRows()).toBe(1);

    if (job.type !== "summary") throw new Error("unreachable");
    expect(stored).toMatchObject({
      type: "summary",
      trigger: "scheduler",
      requester_id: null,
      subject_id: job.movieId,
      input_revision: 4,
      status: "succeeded",
      attempt_count: 1,
      model_id: MODEL_ID,
      prompt_version: "summary-prompt-v1",
      policy_version: null,
      error_code: null,
      bounded_input_snapshot: SNAPSHOT,
      expires_after_seconds: 7 * 86_400,
    });
    expect(JSON.parse(stored.dedup_key)).toEqual(["summary", job.movieId, 4, MODEL_ID, "summary-prompt-v1"]);
    expect(stored.input_hash).toBe(
      createHash("sha256")
        .update(JSON.stringify(MESSAGES.map(({ role, content }) => ({ role, content }))))
        .digest("hex"),
    );
    // Step-1 time + AI_EXECUTION_DEADLINE_MS + 15 s (D-65), measured from created_at (the transaction start).
    expect(stored.lease_seconds).toBeGreaterThanOrEqual(90);
    expect(stored.lease_seconds).toBeLessThan(91);

    expect(await onlyReservation()).toMatchObject({
      ai_job_id: stored.id,
      reserved_microdollars: R,
      status: "reconciled",
      input_tokens: 100,
      output_tokens: 50,
      actual_microdollars: USAGE_COST,
      reconciled: true,
    });
    await expectSettled(USAGE_COST);
    expect(await day()).toMatchObject({ budget: LIMITS.dailyBudgetMicrodollars });
    expect(await quotaUnits()).toBe(1);
  });

  it("records a review_write moderation job with its requester and policy (D-64)", async () => {
    const requesterId = (await insertAccount(owner)) as AccountId;
    const reviewId = randomUUID() as ReviewId;
    const { controller } = harness({ provider: fake(success()) });

    await controller.run(
      request({
        job: {
          type: "review_moderation",
          reviewId,
          captured: { contentRevision: 3 as ContentRevision, version: 9 as RowVersion },
          requesterId,
          promptVersion: "review-screening-prompt-v1",
          policyVersion: "profanity-policy-v0",
        },
      }),
    );

    const stored = await onlyJob();
    expect(stored).toMatchObject({
      type: "review_moderation",
      trigger: "review_write",
      requester_id: requesterId,
      subject_id: reviewId,
      input_revision: 3,
      policy_version: "profanity-policy-v0",
      status: "succeeded",
    });
    expect(JSON.parse(stored.dedup_key)).toEqual([
      "review_moderation",
      reviewId,
      3,
      MODEL_ID,
      "review-screening-prompt-v1",
      "profanity-policy-v0",
    ]);
  });

  it("records a recovery-sweep moderation job as a scheduler job without a requester", async () => {
    const { controller } = harness({ provider: fake(success()) });

    await controller.run(
      request({
        job: {
          type: "review_moderation",
          reviewId: randomUUID() as ReviewId,
          captured: { contentRevision: 1 as ContentRevision, version: 1 as RowVersion },
          requesterId: null,
          promptVersion: "review-screening-prompt-v1",
          policyVersion: "profanity-policy-v0",
        },
      }),
    );

    expect(await onlyJob()).toMatchObject({ trigger: "scheduler", requester_id: null });
  });
});

describe("AiExecutionController.run — provider outcomes (D-61, D-63, D-74)", () => {
  it("defers a 429 on both attempts with the last Retry-After, charges 0 and fails the job", async () => {
    const provider = fake(
      fail({ kind: "rate_limited", retryAfterSeconds: 2 }),
      fail({ kind: "rate_limited", retryAfterSeconds: 7 }),
    );
    const { controller, time } = harness({ provider });

    await expect(controller.run(request())).resolves.toEqual({ kind: "deferred", retryAfterSeconds: 7 });

    expect(time.firedSleeps).toContain(2_000); // the backoff honoured Retry-After exactly (D-69)
    expect(await onlyJob()).toMatchObject({ status: "failed", attempt_count: 2, error_code: "provider_rate_limited" });
    expect(await onlyReservation()).toMatchObject({ status: "released", actual_microdollars: 0, input_tokens: null });
    await expectSettled(0);
    expect(await quotaUnits()).toBe(2);
    expect(await publishedRows()).toBe(0);
  });

  it("retries a 429 without Retry-After after 1,000–3,000 ms of jitter and publishes", async () => {
    const provider = fake(fail({ kind: "rate_limited", retryAfterSeconds: null }), success());
    const { controller, time } = harness({ provider });
    time.setRandom(0.5);

    const outcome = await controller.run(request());

    expect(outcome).toMatchObject({ kind: "published" });
    expect(time.firedSleeps).toContain(2_000); // 1,000 + 0.5 × 2,000
    expect(await onlyJob()).toMatchObject({ status: "succeeded", attempt_count: 2 });
    // The refused attempt costs nothing, so the priced one alone is recorded with its usage.
    expect(await onlyReservation()).toMatchObject({
      status: "reconciled",
      input_tokens: 100,
      output_tokens: 50,
      actual_microdollars: USAGE_COST,
    });
    await expectSettled(USAGE_COST);
  });

  it("fails transiently after two timeouts and charges two unknown attempts at 2R", async () => {
    const { controller, time } = harness({ provider: fake(HANG, HANG) });

    const outcome = await controller.run(request());

    const stored = await onlyJob();
    expect(outcome).toEqual({ kind: "failed", jobId: stored.id, cause: "transient" });
    expect(time.firedSleeps).toEqual([30_000, 1_000, 30_000]); // attempt timer, backoff, attempt timer
    expect(stored).toMatchObject({ status: "failed", attempt_count: 2, error_code: "provider_timeout" });
    expect(await onlyReservation()).toMatchObject({ status: "reconciled", actual_microdollars: null, input_tokens: null });
    await expectSettled(2 * R);
  });

  it("fails transiently after two unavailable attempts", async () => {
    const { controller } = harness({ provider: fake(fail({ kind: "unavailable" }), fail({ kind: "unavailable" })) });

    const outcome = await controller.run(request());

    expect(outcome).toMatchObject({ kind: "failed", cause: "transient" });
    expect(await onlyJob()).toMatchObject({ status: "failed", attempt_count: 2, error_code: "provider_unavailable" });
    await expectSettled(2 * R);
  });

  it("charges an unknown-usage success at R", async () => {
    const { controller } = harness({ provider: fake(success("ok:summary", null)) });

    await expect(controller.run(request())).resolves.toMatchObject({ kind: "published" });

    expect(await onlyReservation()).toMatchObject({ status: "reconciled", actual_microdollars: null, input_tokens: null });
    await expectSettled(R);
  });

  it("charges R plus the priced attempt when the first attempt's usage is unknown", async () => {
    const { controller } = harness({ provider: fake(fail({ kind: "unavailable" }), success()) });

    await expect(controller.run(request())).resolves.toMatchObject({ kind: "published" });

    expect(await onlyReservation()).toMatchObject({ status: "reconciled", actual_microdollars: null, input_tokens: null });
    await expectSettled(R + USAGE_COST);
  });

  it("does not retry rejected: failed provider_rejected, released at 0", async () => {
    const provider = fake(fail({ kind: "rejected" }), success());
    const { controller } = harness({ provider });

    const outcome = await controller.run(request());

    const stored = await onlyJob();
    expect(outcome).toEqual({ kind: "failed", jobId: stored.id, cause: "provider_rejected" });
    expect(provider.requests).toHaveLength(1);
    expect(stored).toMatchObject({ status: "failed", attempt_count: 1, error_code: "provider_rejected" });
    expect(await onlyReservation()).toMatchObject({ status: "released", actual_microdollars: 0 });
    await expectSettled(0);
    expect(await quotaUnits()).toBe(1);
  });

  it("does not retry malformed_response: failed provider_rejected, charged R", async () => {
    const provider = fake(fail({ kind: "malformed_response" }), success());
    const { controller } = harness({ provider });

    const outcome = await controller.run(request());

    expect(outcome).toMatchObject({ kind: "failed", cause: "provider_rejected" });
    expect(provider.requests).toHaveLength(1);
    expect(await onlyJob()).toMatchObject({ status: "failed", attempt_count: 1, error_code: "provider_malformed_response" });
    await expectSettled(R);
  });

  it("does not retry misconfigured: deferred with no hint, failed provider_misconfigured, charged 0 (D-74)", async () => {
    const provider = fake(fail({ kind: "misconfigured" }), success());
    const { controller } = harness({ provider });

    await expect(controller.run(request())).resolves.toEqual({ kind: "deferred", retryAfterSeconds: null });

    expect(provider.requests).toHaveLength(1);
    expect(await onlyJob()).toMatchObject({ status: "failed", attempt_count: 1, error_code: "provider_misconfigured" });
    expect(await onlyReservation()).toMatchObject({ status: "released", actual_microdollars: 0 });
    await expectSettled(0);
  });

  it("does not retry output that fails validate: failed invalid_output, never published", async () => {
    const provider = fake(success("not ok"), success());
    const publish = vi.fn(recordingPublish(first));
    const { controller } = harness({ provider });

    const outcome = await controller.run(request({ publish }));

    expect(outcome).toMatchObject({ kind: "failed", cause: "invalid_output" });
    expect(provider.requests).toHaveLength(1);
    expect(publish).not.toHaveBeenCalled();
    expect(await onlyJob()).toMatchObject({ status: "failed", attempt_count: 1, error_code: "invalid_output" });
    await expectSettled(USAGE_COST);
  });

  it("maps a throw from validate to failed transient storage_failed (D-75)", async () => {
    const { controller } = harness({ provider: fake(success()) });

    const outcome = await controller.run(
      request({
        validate: () => {
          throw new Error("validator bug");
        },
      }),
    );

    expect(outcome).toMatchObject({ kind: "failed", cause: "transient" });
    expect(await onlyJob()).toMatchObject({ status: "failed", error_code: "storage_failed" });
    await expectSettled(USAGE_COST);
  });

  it("rolls back a publish the callback reports stale: stale publish_stale", async () => {
    const { controller } = harness({ provider: fake(success()) });
    const writeThenStale: Publish = async (tx, output, job) => {
      await recordingPublish(first)(tx, output, job);
      return { ok: false, error: { kind: "stale" } };
    };

    const outcome = await controller.run(request({ publish: writeThenStale }));

    const stored = await onlyJob();
    expect(outcome).toEqual({ kind: "stale", jobId: stored.id });
    expect(stored).toMatchObject({ status: "stale", attempt_count: 1, error_code: "publish_stale" });
    expect(await publishedRows()).toBe(0);
    await expectSettled(USAGE_COST);
  });

  it("rolls back a publish that throws: failed transient storage_failed (D-75)", async () => {
    const { controller } = harness({ provider: fake(success()) });
    const writeThenThrow: Publish = async (tx, output, job) => {
      await recordingPublish(first)(tx, output, job);
      throw new Error("publish bug");
    };

    const outcome = await controller.run(request({ publish: writeThenThrow }));

    expect(outcome).toMatchObject({ kind: "failed", cause: "transient" });
    expect(await onlyJob()).toMatchObject({ status: "failed", error_code: "storage_failed" });
    expect(await publishedRows()).toBe(0);
    await expectSettled(USAGE_COST);
  });

  it("rolls back a publish whose AIJob lease has passed at the P-08 check: stale lease_expired (D-73)", async () => {
    const { controller } = harness({ provider: fake(success()) });
    const expireThenWrite: Publish = async (tx, output, job) => {
      // Another connection expires the lease after the callback's domain locks, before the P-08 update.
      await owner.query("UPDATE app.ai_job SET lease_until = clock_timestamp() - interval '1 second' WHERE id = $1", [
        job.jobId,
      ]);
      return recordingPublish(first)(tx, output, job);
    };

    const outcome = await controller.run(request({ publish: expireThenWrite }));

    const stored = await onlyJob();
    expect(outcome).toEqual({ kind: "stale", jobId: stored.id });
    expect(stored).toMatchObject({ status: "stale", error_code: "lease_expired" });
    expect(await publishedRows()).toBe(0);
    await expectSettled(USAGE_COST);
  });

  it("never logs prompts, content or provider errors", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { controller } = harness({ provider: fake(fail({ kind: "unavailable" }), success("not ok")) });

    await controller.run(request());

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("AiExecutionController.run — caps (D-68)", () => {
  it.each([0, -1, 1.5, 1_201, Number.NaN])("throws for maxOutputTokens %s before any write", async (maxOutputTokens) => {
    const provider = fake(success());
    const { controller } = harness({ provider });

    await expect(controller.run(request({ maxOutputTokens }))).rejects.toThrow();

    expect(provider.requests).toEqual([]);
    await expectNoWrites();
  });

  it("accepts the 1,200-token summary cap", async () => {
    const { controller } = harness({ provider: fake(success()) });

    await expect(controller.run(request({ maxOutputTokens: 1_200 }))).resolves.toMatchObject({ kind: "published" });
  });

  it("returns input_too_large from the recomputed estimate even when the caller's is small", async () => {
    const provider = fake(success());
    const { controller } = harness({ provider, limits: { inputTokenLimit: 35 } }); // the estimate is 36

    await expect(controller.run(request({ input: { estimatedInputTokens: 1 } }))).resolves.toEqual({
      kind: "input_too_large",
    });

    expect(provider.requests).toEqual([]);
    await expectNoWrites();
  });

  it("returns input_too_large when the caller's estimate is over the limit", async () => {
    const { controller } = harness({ provider: fake(success()) });

    await expect(controller.run(request({ input: { estimatedInputTokens: 8_001 } }))).resolves.toEqual({
      kind: "input_too_large",
    });
    await expectNoWrites();
  });

  it("reserves from the larger of the two estimates", async () => {
    const { controller } = harness({ provider: fake(fail({ kind: "rejected" })) });

    await controller.run(request({ input: { estimatedInputTokens: 5_000 } }));

    // ceil((5,000 × 411,810 + 1,000 × 1,456,571) ÷ 10^6) = ceil(3,515.621)
    expect(await onlyReservation()).toMatchObject({ reserved_microdollars: 3_516 });
  });
});

describe("AiExecutionController.run — the ai_execution slot (D-66, D-67, D-77)", () => {
  it("defers on the unlocked pre-check with the lease's remaining seconds and consumes nothing", async () => {
    await seedHeldLease(40);
    const provider = fake(success());
    const { controller } = harness({ provider });

    const outcome = await controller.run(request());

    expect(outcome).toMatchObject({ kind: "deferred" });
    const hint = outcome.kind === "deferred" ? outcome.retryAfterSeconds : null;
    expect(hint).toBeGreaterThanOrEqual(39);
    expect(hint).toBeLessThanOrEqual(40);
    expect(provider.requests).toEqual([]);
    expect(await quotaUnits()).toBe(0);
    expect(await day()).toBeNull();
    expect(await jobs()).toEqual([]);
  });

  it("defers a second concurrent run with the slot hint while the first is calling the provider", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocking: LlmProvider = {
      modelId: MODEL_ID,
      async complete() {
        entered();
        await gate;
        return { ok: true, value: { content: "ok:summary", usage: USAGE } };
      },
    };
    // Timers fire only on demand, so the first run's attempt timer cannot abort it while the test waits.
    const runA = harness({ provider: blocking, time: createManualTime({ autoAdvance: false }) }).controller.run(request());
    await inFlight;

    const providerB = fake(success());
    const outcomeB = await harness({ provider: providerB, database: second }).controller.run(request());
    release();

    expect(outcomeB).toMatchObject({ kind: "deferred" });
    const hint = outcomeB.kind === "deferred" ? outcomeB.retryAfterSeconds : null;
    expect(hint).toBeGreaterThanOrEqual(85); // ~90 s lease (D-65), less the time run A took
    expect(hint).toBeLessThanOrEqual(90);
    expect(providerB.requests).toEqual([]);
    await expect(runA).resolves.toMatchObject({ kind: "published" });
    expect(await jobs()).toHaveLength(1);
    expect(await quotaUnits()).toBe(1);
  });

  it("lets step 1 decide when the slot is taken after the pre-check: deferred, unit spent, nothing else written", async () => {
    let token = "";
    const { controller } = harness({
      provider: fake(success()),
      rateLimiter: interceptConsume(async (_call, consume) => {
        const outcome = await consume();
        token = await seedHeldLease(30);
        return outcome;
      }),
    });

    const outcome = await controller.run(request());

    expect(outcome).toMatchObject({ kind: "deferred" });
    const hint = outcome.kind === "deferred" ? outcome.retryAfterSeconds : null;
    expect(hint).toBeGreaterThanOrEqual(29);
    expect(hint).toBeLessThanOrEqual(30);
    expect(await quotaUnits()).toBe(1);
    expect(await lease()).toEqual({ held: true, token });
    expect(await jobs()).toEqual([]);
    expect(await day()).toBeNull(); // step 1 rolled back
  });

  it("returns duplicate when a running job holds the dedup key, and writes nothing (D-66)", async () => {
    const job = summaryJob();
    if (job.type !== "summary") throw new Error("unreachable");
    const dedupKey = JSON.stringify(["summary", job.movieId, 4, MODEL_ID, "summary-prompt-v1"]);
    const runningId = await seedJob({ status: "running", leaseFromNow: "60 seconds", dedupKey });
    const provider = fake(success());
    const { controller } = harness({ provider });

    await expect(controller.run(request({ job }))).resolves.toEqual({ kind: "duplicate", jobId: runningId });

    expect(provider.requests).toEqual([]);
    expect(await jobs()).toHaveLength(1);
    expect(await reservations()).toEqual([]);
    expect(await lease()).toBeNull();
    expect(await day()).toBeNull();
  });
});

describe("AiExecutionController.run — budget and abandoned work (D-63, D-66, D-73, D-77, D-78)", () => {
  it("defers to the next UTC midnight when the budget is spent, and still commits the expiry", async () => {
    // Yesterday: an abandoned execution whose R = 300 is settled at R × 2 = 600, capped at the 400 headroom.
    await seedDay(-1, 1_000, 300, 600);
    const abandonedId = await seedJob({ status: "running", leaseFromNow: "-1 minute" });
    await seedReservation(abandonedId, -1, 300);
    // Today: 9,000 of a 10,000 budget is consumed, so R = 1,472 cannot fit.
    await seedDay(0, 10_000, 0, 9_000);
    const provider = fake(success());
    const { controller } = harness({ provider, limits: { dailyBudgetMicrodollars: 10_000 } });

    const expected = await secondsToNextUtcDay();
    const outcome = await controller.run(request());

    expect(outcome).toMatchObject({ kind: "deferred" });
    const hint = outcome.kind === "deferred" ? outcome.retryAfterSeconds : null;
    expect(hint).toBeGreaterThanOrEqual(Math.max(1, expected - 2));
    expect(hint).toBeLessThanOrEqual(expected);
    expect(provider.requests).toEqual([]);

    expect(await jobs()).toEqual([expect.objectContaining({ id: abandonedId, status: "stale", error_code: "lease_expired" })]);
    expect(await onlyReservation()).toMatchObject({
      ai_job_id: abandonedId,
      status: "reconciled",
      actual_microdollars: null,
      input_tokens: null,
      reconciled: true,
    });
    expect(await day(-1)).toEqual({ budget: 1_000, reserved: 0, consumed: 1_000 });
    expect(await day(0)).toEqual({ budget: 10_000, reserved: 0, consumed: 9_000 });
    expect(await lease()).toMatchObject({ held: false }); // the slot was not taken
  });

  it("settles a reservation left reserved after a committed publish without changing the job (D-73)", async () => {
    const publishedId = await seedJob({ status: "succeeded", leaseFromNow: "-1 second" });
    await seedDay(0, LIMITS.dailyBudgetMicrodollars, 500, 0);
    await seedReservation(publishedId, 0, 500);
    const { controller } = harness({ provider: fake(success()) });

    await expect(controller.run(request())).resolves.toMatchObject({ kind: "published" });

    const all = await jobs();
    expect(all.find((job) => job.id === publishedId)).toMatchObject({ status: "succeeded", error_code: null });
    expect((await reservations()).find((row) => row.ai_job_id === publishedId)).toMatchObject({ status: "reconciled" });
    await expectSettled(2 * 500 + USAGE_COST);
  });

  it("leaves a running job with an unexpired lease alone", async () => {
    const otherId = await seedJob({ status: "running", leaseFromNow: "60 seconds" });
    await seedDay(0, LIMITS.dailyBudgetMicrodollars, 500, 0);
    await seedReservation(otherId, 0, 500);
    const { controller } = harness({ provider: fake(success()) });

    await controller.run(request());

    expect((await jobs()).find((job) => job.id === otherId)).toMatchObject({ status: "running" });
    expect((await reservations()).find((row) => row.ai_job_id === otherId)).toMatchObject({ status: "reserved" });
    expect(await day()).toMatchObject({ reserved: 500, consumed: USAGE_COST });
  });

  it("raises today's budget to the configured value", async () => {
    await seedDay(0, 2_000, 0, 0);
    const { controller } = harness({ provider: fake(success()) });

    await controller.run(request());

    expect(await day()).toMatchObject({ budget: LIMITS.dailyBudgetMicrodollars });
  });

  it("never lowers today's budget below reserved + consumed", async () => {
    await seedDay(0, 60_000, 0, 30_000);
    const { controller } = harness({ provider: fake(success()), limits: { dailyBudgetMicrodollars: 10_000 } });

    await expect(controller.run(request())).resolves.toMatchObject({ kind: "deferred" });

    expect(await day()).toEqual({ budget: 30_000, reserved: 0, consumed: 30_000 });
  });
});

describe("AiExecutionController.run — deadline (D-65, D-76)", () => {
  it("does not start a second attempt that would leave less than 5 s before the attempt end point", async () => {
    // Deadline 40 s: attempts must end by 35 s. After a 30 s timeout and a 1 s backoff only 4 s would remain.
    const provider = fake(HANG, success());
    const { controller } = harness({ provider, limits: { executionDeadlineMs: 40_000 } });

    const outcome = await controller.run(request());

    expect(outcome).toMatchObject({ kind: "failed", cause: "transient" });
    expect(provider.requests).toHaveLength(1);
    expect(await onlyJob()).toMatchObject({ attempt_count: 1, error_code: "provider_timeout" });
    expect(await quotaUnits()).toBe(1);
    await expectSettled(R);
  });

  it("does not retry when Retry-After does not fit in the time left", async () => {
    // Attempts end by 70 s; 66 s of Retry-After leaves only 4 s.
    const provider = fake(fail({ kind: "rate_limited", retryAfterSeconds: 66 }), success());
    const { controller, time } = harness({ provider });

    await expect(controller.run(request())).resolves.toEqual({ kind: "deferred", retryAfterSeconds: 66 });

    expect(provider.requests).toHaveLength(1);
    expect(time.firedSleeps).toEqual([]);
  });

  it("retries when Retry-After leaves exactly 5 s before the attempt end point", async () => {
    const provider = fake(fail({ kind: "rate_limited", retryAfterSeconds: 65 }), success());
    const { controller, time } = harness({ provider });

    await expect(controller.run(request())).resolves.toMatchObject({ kind: "published" });

    expect(provider.requests).toHaveLength(2);
    expect(time.firedSleeps).toEqual([65_000]);
  });

  it("blocks a late first attempt: failed transient deadline_exceeded, released, no request", async () => {
    const time = createManualTime();
    const provider = fake(success());
    const { controller } = harness({
      provider,
      time,
      // The quota call takes 66 s, leaving 4 s before the 70 s attempt end point.
      rateLimiter: interceptConsume(async (_call, consume) => {
        time.advance(66_000);
        return consume();
      }),
    });

    const outcome = await controller.run(request());

    const stored = await onlyJob();
    expect(outcome).toEqual({ kind: "failed", jobId: stored.id, cause: "transient" });
    expect(provider.requests).toEqual([]);
    expect(stored).toMatchObject({ status: "failed", attempt_count: 0, error_code: "deadline_exceeded" });
    expect(await onlyReservation()).toMatchObject({ status: "released", actual_microdollars: 0 });
    await expectSettled(0);
  });

  it("starts a first attempt with exactly 5 s left and aborts it at the attempt end point", async () => {
    const time = createManualTime();
    const provider = fake(HANG);
    const { controller } = harness({
      provider,
      time,
      limits: { maxAttempts: 1 },
      rateLimiter: interceptConsume(async (_call, consume) => {
        time.advance(65_000);
        return consume();
      }),
    });

    await expect(controller.run(request())).resolves.toMatchObject({ kind: "failed", cause: "transient" });

    expect(provider.requests).toHaveLength(1);
    expect(time.firedSleeps).toEqual([5_000]);
  });

  it("does not start the publish transaction after the deadline: failed transient deadline_exceeded", async () => {
    const time = createManualTime();
    const publish = vi.fn(recordingPublish(first));
    const { controller } = harness({ provider: fake(success()), time });
    const slowValidate: Validate = (content) => {
      time.advance(75_000);
      return parseOk(content);
    };

    const outcome = await controller.run(request({ validate: slowValidate, publish }));

    expect(outcome).toMatchObject({ kind: "failed", cause: "transient" });
    expect(publish).not.toHaveBeenCalled();
    expect(await onlyJob()).toMatchObject({ status: "failed", attempt_count: 1, error_code: "deadline_exceeded" });
    await expectSettled(USAGE_COST);
  });
});

describe("AiExecutionController.run — quota and bookkeeping faults (D-62, D-75)", () => {
  it("defers with K6's retry hint when the first unit is denied, writing nothing else", async () => {
    const provider = fake(success());
    const { controller } = harness({
      provider,
      rateLimiter: interceptConsume(async () => ({ allowed: false, retryAfterSeconds: 42 })),
    });

    await expect(controller.run(request())).resolves.toEqual({ kind: "deferred", retryAfterSeconds: 42 });

    expect(provider.requests).toEqual([]);
    await expectNoWrites();
  });

  it("makes no second attempt when its unit is denied; the outcome comes from the first attempt", async () => {
    const provider = fake(fail({ kind: "unavailable" }), success());
    const { controller } = harness({
      provider,
      rateLimiter: interceptConsume(async (call, consume) =>
        call === 1 ? consume() : { allowed: false, retryAfterSeconds: 30 },
      ),
    });

    const outcome = await controller.run(request());

    expect(outcome).toMatchObject({ kind: "failed", cause: "transient" });
    expect(provider.requests).toHaveLength(1);
    expect(await onlyJob()).toMatchObject({ attempt_count: 1, error_code: "provider_unavailable" });
  });

  it("defers with no hint when the quota consume fails", async () => {
    const { controller } = harness({
      provider: fake(success()),
      rateLimiter: interceptConsume(async () => {
        throw new Error("database unreachable");
      }),
    });

    await expect(controller.run(request())).resolves.toEqual({ kind: "deferred", retryAfterSeconds: null });
    await expectNoWrites();
  });

  it("defers with no hint when the pre-check fails", async () => {
    const provider = fake(success());
    const { controller, database } = harness({ provider });
    database.failNextTransaction();

    await expect(controller.run(request())).resolves.toEqual({ kind: "deferred", retryAfterSeconds: null });

    expect(provider.requests).toEqual([]);
    await expectNoWrites();
  });

  it("defers with no hint and rolls step 1 back when it fails", async () => {
    const provider = fake(success());
    const { controller } = harness({ provider });
    // A BigInt cannot be serialized as bounded_input_snapshot, so step 1 throws after its first writes.
    const unserializable = { value: BigInt(1) } as unknown as Readonly<Record<string, unknown>>;

    await expect(controller.run(request({ input: { snapshot: unserializable } }))).resolves.toEqual({
      kind: "deferred",
      retryAfterSeconds: null,
    });

    expect(provider.requests).toEqual([]);
    expect(await quotaUnits()).toBe(1);
    expect(await lease()).toBeNull();
    expect(await day()).toBeNull();
    expect(await jobs()).toEqual([]);
  });

  it("keeps a published outcome when settlement fails; the lease and reservation wait for step 1", async () => {
    const { controller, database } = harness({ provider: fake(success()) });
    const publishThenBreakSettlement: Publish = async (tx, output, job) => {
      database.failNextTransaction();
      return recordingPublish(first)(tx, output, job);
    };

    const outcome = await controller.run(request({ publish: publishThenBreakSettlement }));

    expect(outcome).toMatchObject({ kind: "published" });
    expect(await onlyJob()).toMatchObject({ status: "succeeded" });
    expect(await onlyReservation()).toMatchObject({ status: "reserved" });
    expect(await lease()).toMatchObject({ held: true });
    expect(await day()).toMatchObject({ reserved: R, consumed: 0 });
  });

  it("keeps a failed outcome when settlement fails; the job stays running", async () => {
    const provider = fake(fail({ kind: "rejected" }));
    const { controller, database } = harness({ provider: observed(provider, () => database.failNextTransaction()) });

    const outcome = await controller.run(request());

    expect(outcome).toMatchObject({ kind: "failed", cause: "provider_rejected" });
    expect(await onlyJob()).toMatchObject({ status: "running" });
    expect(await onlyReservation()).toMatchObject({ status: "reserved" });
  });
});

describe("AiExecutionController.run — no transaction during complete() (§3.1 rule 4, AI-03)", () => {
  it("has no transaction open on this pool whenever the provider is called", async () => {
    const openAtCall: number[] = [];
    const inner = fake(fail({ kind: "unavailable" }), success());
    const observedDatabase: { current?: InstrumentedDatabase } = {};
    const built = harness({ provider: observed(inner, () => openAtCall.push(observedDatabase.current!.openTransactions)) });
    observedDatabase.current = built.database;

    await expect(built.controller.run(request())).resolves.toMatchObject({ kind: "published" });

    expect(openAtCall).toEqual([0, 0]);
  });

  it("requires no transaction on entry: calling run inside one fails closed as deferred", async () => {
    const { controller } = harness({ provider: fake(success()) });

    const outcome = await first.withTransaction(async () => controller.run(request()));

    expect(outcome).toEqual({ kind: "deferred", retryAfterSeconds: null });
    await expectNoWrites();
  });
});
