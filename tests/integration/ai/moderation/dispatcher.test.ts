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
  createModerationReviewReadRepository,
  createModerationWorkRepository,
  createReviewModerationRepository,
} from "../../../../src/server/repositories/ai";
import { createReviewRepository } from "../../../../src/server/repositories/reviews";
import {
  createModerationDispatcher,
  createModerationWorkQueue,
  MODERATION_MAX_OUTPUT_TOKENS,
  PROFANITY_POLICY_VERSION,
  REVIEW_SCREENING_PROMPT_VERSION,
  type ModerationDispatcher,
  type ModerationRecovery,
  type ModerationSettings,
} from "../../../../src/server/services/ai/moderation";
import { createAiExecutionController, type AiExecutionLimits } from "../../../../src/server/services/ai/runtime";
import { createAuditLog } from "../../../../src/server/services/audit";
import { createMovieLocks, createReviewsChangedMarker } from "../../../../src/server/services/catalogue";
import { createRateLimiter, createRateLimitKeys } from "../../../../src/server/services/rate-limit";
import { createReviewLocksAndReads, createReviewTransitions } from "../../../../src/server/services/reviews";
import type { ContentRevision, RequestId, ReviewId } from "../../../../src/server/shared";
import { createLoginRole, dropLoginRole } from "../../../setup/test-database.mjs";
import { createManualTime } from "../../../support/fakes/manual-time";
import { instrumentDatabase, type InstrumentedDatabase } from "../../../support/instrumented-database";
import { connectAsOwner } from "../../database/schema-fixtures";
import {
  seedReview as seedReviewRow,
  seedWork as seedWorkRow,
  SYNTHETIC_BODY,
  workRows as workRowsOf,
  type ReviewSeed,
  type SeededReview,
  type WorkRow,
  type WorkSeed,
} from "./fixtures";
import { testDatabaseUrl } from "../../database/test-database";

// The real K9 dispatcher (D-101) against PostgreSQL with real K8, K5 and K10 and a scripted provider. Review rows
// are written directly as synthetic fixtures; the race stand-ins write what U-02 and A-04 would commit.

const RUNTIME_ROLE = `mp3_moderation_${randomBytes(4).toString("hex")}`;
const RUNTIME_PASSWORD = randomBytes(24).toString("hex");

const MODEL_ID = "fake-model";
const REQUEST_ID = "50000000-0000-4000-8000-000000000101" as RequestId;
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
const SETTINGS: ModerationSettings = { modelId: MODEL_ID, inputTokenLimit: 8_000, maxExecutions: 3 };
const USAGE = { inputTokens: 100, outputTokens: 50 };

const BODY = SYNTHETIC_BODY;
const CLEAN = JSON.stringify({
  assessment: "no_profanity_detected",
  explanation: "No profanity.",
  matches: [],
  limitations: [],
});
const SUSPECTED = JSON.stringify({
  assessment: "suspected_profanity",
  explanation: "An obfuscated vulgar word is used as an insult.",
  matches: [{ quote: "sh1tty actor", reason: "Obfuscated vulgar insult (items 1a and 2)." }],
  limitations: [],
});
const UNCERTAIN = JSON.stringify({
  assessment: "uncertain",
  explanation: "Needs human review.",
  matches: [],
  limitations: ["Human review is required."],
});
const INVENTED_QUOTE = JSON.stringify({
  assessment: "suspected_profanity",
  explanation: "Invented quotation.",
  matches: [{ quote: "a word that is not in the review", reason: "Invented." }],
  limitations: [],
});

const success = (content: string): FakeLlmOutcome => ({ kind: "success", content, usage: USAGE });
const failure = (kind: "unavailable" | "rejected" | "timeout"): FakeLlmOutcome => ({ kind: "failure", failure: { kind } });
const RATE_LIMITED: FakeLlmOutcome = { kind: "failure", failure: { kind: "rate_limited", retryAfterSeconds: 120 } };

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
       app.ai_budget_day, app.scheduler_lease, app.rate_limit_window, app.review, app.movie, app.account CASCADE`,
  );
});

// ---------------------------------------------------------------------------------------------------------
// Fixtures

function seedReview(seed: ReviewSeed = {}): Promise<SeededReview> {
  return seedReviewRow(owner, seed);
}

function seedWork(reviewId: ReviewId, seed: WorkSeed = {}): Promise<string> {
  return seedWorkRow(owner, reviewId, seed);
}

function workRows(reviewId: ReviewId): Promise<WorkRow[]> {
  return workRowsOf(owner, reviewId);
}

async function onlyWork(reviewId: ReviewId): Promise<WorkRow> {
  const rows = await workRows(reviewId);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

interface ReviewRow {
  readonly moderation_state: string;
  readonly clearance_source: string | null;
  readonly version: number;
  readonly hidden_at: Date | null;
  readonly deleted_at: Date | null;
}

async function review(reviewId: ReviewId): Promise<ReviewRow> {
  const { rows } = await owner.query<ReviewRow>(
    "SELECT moderation_state, clearance_source, version, hidden_at, deleted_at FROM app.review WHERE id = $1",
    [reviewId],
  );
  return rows[0]!;
}

async function count(table: "ai_job" | "review_moderation" | "audit_entry" | "ai_budget_reservation"): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(`SELECT count(*)::integer AS n FROM app.${table}`);
  return rows[0]!.n;
}

interface JobRow {
  readonly trigger: string;
  readonly requester_id: string | null;
  readonly subject_id: string;
  readonly input_revision: number;
  readonly status: string;
  readonly error_code: string | null;
  readonly model_id: string;
  readonly prompt_version: string;
  readonly policy_version: string | null;
  readonly bounded_input_snapshot: Record<string, unknown>;
}

async function jobs(): Promise<JobRow[]> {
  const { rows } = await owner.query<JobRow>(
    `SELECT trigger, requester_id, subject_id, input_revision, status, error_code, model_id, prompt_version,
            policy_version, bounded_input_snapshot
     FROM app.ai_job ORDER BY created_at, id`,
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------------------
// Harness

interface Harness {
  readonly dispatcher: ModerationDispatcher & ModerationRecovery;
  readonly provider: FakeLlmProvider;
  readonly database: InstrumentedDatabase;
  readonly openDuringCall: number[];
}

/** The composition root's wiring (D-101) with the real controller. `duringCall` runs inside the provider call. */
function harness(
  options: {
    readonly script?: readonly FakeLlmOutcome[];
    readonly duringCall?: () => Promise<void>;
    readonly settings?: Partial<ModerationSettings>;
  } = {},
): Harness {
  const database = instrumentDatabase(app);
  const provider = createFakeLlmProvider({ modelId: MODEL_ID, script: options.script ?? [] });
  const openDuringCall: number[] = [];
  const observed: LlmProvider = {
    modelId: provider.modelId,
    async complete(request) {
      openDuringCall.push(database.openTransactions);
      await options.duringCall?.();
      return provider.complete(request);
    },
  };
  const time = createManualTime({ autoAdvance: options.duringCall === undefined });
  const reviews = createReviewRepository({ sql: database });
  const movieLocks = createMovieLocks({ sql: database });
  const dispatcher = createModerationDispatcher({
    database,
    reviewLocks: createReviewLocksAndReads({ reviews, movieLocks }),
    transitions: createReviewTransitions({ reviews, reviewsChangedMarker: createReviewsChangedMarker({ sql: database }) }),
    work: createModerationWorkRepository({ sql: database }),
    reviewReads: createModerationReviewReadRepository({ sql: database }),
    results: createReviewModerationRepository({ sql: database }),
    auditLog: createAuditLog({ sql: database }),
    controller: createAiExecutionController({
      database,
      sql: database,
      rateLimiter: createRateLimiter({ database, sql: database }),
      socRequestKey: SOC_REQUESTS_KEY,
      provider: observed,
      limits: CONTROLLER_LIMITS,
      random: time.random,
      clock: time.clock,
      sleep: time.sleep,
    }),
    settings: { ...SETTINGS, ...options.settings },
  });
  return { dispatcher, provider, database, openDuringCall };
}

function attempt(h: Harness, seeded: SeededReview, revision = 1) {
  return h.dispatcher.attemptAfterCommit(seeded.reviewId, revision as ContentRevision);
}

// ---------------------------------------------------------------------------------------------------------

describe("publication (AT-09, AT-21: the fixed clearance rule)", () => {
  it("clears a clean Review and records the assessment, the work, the job and the audit entry", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h, seeded)).resolves.toBe("cleared");

    expect(await review(seeded.reviewId)).toMatchObject({ moderation_state: "cleared", clearance_source: "ai", version: 2 });
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "completed", execution_count: 1, model_id: MODEL_ID });
    expect((await onlyWork(seeded.reviewId)).last_attempt_at).not.toBeNull();
    const { rows: results } = await owner.query(
      `SELECT content_revision, captured_review_version, model_id, prompt_version, policy_version, output_json
       FROM app.review_moderation WHERE review_id = $1`,
      [seeded.reviewId],
    );
    expect(results).toEqual([
      {
        content_revision: 1,
        captured_review_version: 1,
        model_id: MODEL_ID,
        prompt_version: REVIEW_SCREENING_PROMPT_VERSION,
        policy_version: PROFANITY_POLICY_VERSION,
        output_json: JSON.parse(CLEAN),
      },
    ]);
    expect(await jobs()).toEqual([
      expect.objectContaining({
        trigger: "review_write",
        requester_id: seeded.authorId,
        subject_id: seeded.reviewId,
        input_revision: 1,
        status: "succeeded",
        policy_version: PROFANITY_POLICY_VERSION,
        bounded_input_snapshot: {
          reviewId: seeded.reviewId,
          contentRevision: 1,
          capturedVersion: 1,
          promptVersion: REVIEW_SCREENING_PROMPT_VERSION,
          policyVersion: PROFANITY_POLICY_VERSION,
        },
      }),
    ]);
    const { rows: audit } = await owner.query(
      "SELECT actor_id, action, target_type, target_id, result, before_after_metadata FROM app.audit_entry",
    );
    expect(audit).toEqual([
      {
        actor_id: null,
        action: "review.auto_clear",
        target_type: "review",
        target_id: seeded.reviewId,
        result: "applied",
        before_after_metadata: { assessment: "no_profanity_detected", contentRevision: 1, jobId: expect.any(String) },
      },
    ]);
  });

  it("flags suspected and uncertain Reviews and audits review.auto_flag", async () => {
    for (const [content, assessment] of [
      [SUSPECTED, "suspected_profanity"],
      [UNCERTAIN, "uncertain"],
    ] as const) {
      const seeded = await seedReview();
      await seedWork(seeded.reviewId);

      await expect(attempt(harness({ script: [success(content)] }), seeded)).resolves.toBe("flagged");

      expect(await review(seeded.reviewId)).toMatchObject({ moderation_state: "flagged", clearance_source: "ai" });
      const { rows } = await owner.query<{ action: string; before_after_metadata: { assessment: string } }>(
        "SELECT action, before_after_metadata FROM app.audit_entry WHERE target_id = $1",
        [seeded.reviewId],
      );
      expect(rows).toEqual([{ action: "review.auto_flag", before_after_metadata: expect.objectContaining({ assessment }) }]);
    }
  });

  it("sends the complete body once with the output cap, and holds no Tx during the provider call", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)] });

    await attempt(h, seeded);

    expect(h.provider.requests).toHaveLength(1);
    expect(h.provider.requests[0]!.maxOutputTokens).toBe(MODERATION_MAX_OUTPUT_TOKENS);
    expect(JSON.parse(h.provider.requests[0]!.messages[1]!.content)).toEqual({
      reviewId: seeded.reviewId,
      contentRevision: 1,
      body: BODY,
    });
    expect(h.openDuringCall).toEqual([0]);
  });

  it("records the sweep's attempt with trigger scheduler and no requester", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);

    await expect(
      harness({ script: [success(CLEAN)] }).dispatcher.attemptFromSweep(seeded.reviewId, 1 as ContentRevision, REQUEST_ID),
    ).resolves.toBe("cleared");

    expect(await jobs()).toEqual([expect.objectContaining({ trigger: "scheduler", requester_id: null })]);
    const { rows } = await owner.query<{ request_id: string }>("SELECT request_id FROM app.audit_entry");
    expect(rows).toEqual([{ request_id: REQUEST_ID }]);
  });
});

describe("manual review and retries (AI-02, AT-24)", () => {
  it("sends an invented quotation to manual review and leaves the Review pending", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);

    await expect(attempt(harness({ script: [success(INVENTED_QUOTE)] }), seeded)).resolves.toBe("manual_review");

    expect(await review(seeded.reviewId)).toMatchObject({ moderation_state: "pending", clearance_source: null, version: 1 });
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "needs_manual_review", execution_count: 1 });
    expect(await jobs()).toEqual([expect.objectContaining({ status: "failed", error_code: "invalid_output" })]);
    expect(await count("review_moderation")).toBe(0);
    expect(await count("audit_entry")).toBe(0);
  });

  it("sends a provider rejection to manual review without a retry", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({ script: [failure("rejected")] });

    await expect(attempt(h, seeded)).resolves.toBe("manual_review");

    expect(h.provider.requests).toHaveLength(1);
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "needs_manual_review", execution_count: 1 });
  });

  it("backs off after a transient failure and reaches manual review after 3 failed executions", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);

    await expect(attempt(harness({ script: [failure("unavailable"), failure("unavailable")] }), seeded)).resolves.toBe(
      "deferred",
    );
    const first = await onlyWork(seeded.reviewId);
    expect(first).toMatchObject({ status: "pending", execution_count: 1 });
    expect(first.last_attempt_at).not.toBeNull();
    expect(first.next_in_seconds).toBeGreaterThanOrEqual(15 * 60 - 5);
    expect(first.next_in_seconds).toBeLessThanOrEqual(15 * 60 + 5);

    await expect(attempt(harness({ script: [failure("timeout"), failure("timeout")] }), seeded)).resolves.toBe(
      "deferred",
    );
    const second = await onlyWork(seeded.reviewId);
    expect(second).toMatchObject({ status: "pending", execution_count: 2 });
    expect(second.next_in_seconds).toBeGreaterThanOrEqual(60 * 60 - 5);

    await expect(attempt(harness({ script: [failure("unavailable"), failure("unavailable")] }), seeded)).resolves.toBe(
      "manual_review",
    );
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "needs_manual_review", execution_count: 3 });
    expect(await review(seeded.reviewId)).toMatchObject({ moderation_state: "pending" });
  });

  it("does not consume an execution for a provider 429, and honours its retry hint", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);

    await expect(attempt(harness({ script: [RATE_LIMITED] }), seeded)).resolves.toBe("deferred");

    const work = await onlyWork(seeded.reviewId);
    expect(work).toMatchObject({ status: "pending", execution_count: 0, last_attempt_at: null });
    expect(work.next_in_seconds).toBeGreaterThanOrEqual(115);
    expect(work.next_in_seconds).toBeLessThanOrEqual(125);
  });

  it("does not consume an execution when the AI slot is busy, and calls no provider", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    await owner.query(
      "INSERT INTO app.scheduler_lease (name, lease_token, lease_until) VALUES ('ai_execution', gen_random_uuid(), now() + interval '1 minute')",
    );
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h, seeded)).resolves.toBe("deferred");

    expect(h.provider.requests).toHaveLength(0);
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "pending", execution_count: 0, last_attempt_at: null });
  });

  it("sends work already at the execution limit to manual review without a provider call (D-55)", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { executionCount: 3 });
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h, seeded)).resolves.toBe("manual_review");

    expect(h.provider.requests).toHaveLength(0);
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "needs_manual_review", execution_count: 3 });
    expect(await count("ai_job")).toBe(0);
  });

  it("never re-screens needs_manual_review work", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { status: "needs_manual_review", executionCount: 1 });
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h, seeded)).resolves.toBe("manual_review");

    expect(h.provider.requests).toHaveLength(0);
  });

  it("sends a body over the input limit to manual review without an AIJob or a fragment (AI-02)", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)], settings: { inputTokenLimit: 100 } });

    await expect(attempt(h, seeded)).resolves.toBe("manual_review");

    expect(h.provider.requests).toHaveLength(0);
    expect(await count("ai_job")).toBe(0);
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "needs_manual_review", execution_count: 0 });
  });
});

describe("hidden, deleted, archived and not-current Reviews (D-54)", () => {
  for (const state of [{ hidden: true }, { deleted: true }] as const) {
    it(`cancels the work of a ${Object.keys(state)[0]} Review with no provider call, AIJob or budget`, async () => {
      const seeded = await seedReview(state);
      await seedWork(seeded.reviewId);
      const h = harness({ script: [success(CLEAN)] });

      await expect(attempt(h, seeded)).resolves.toBe("not_current");

      expect(h.provider.requests).toHaveLength(0);
      expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "cancelled", execution_count: 0 });
      expect(await count("ai_job")).toBe(0);
      expect(await count("ai_budget_reservation")).toBe(0);
      const { rows } = await owner.query("SELECT 1 FROM app.rate_limit_window");
      expect(rows).toEqual([]);
    });
  }

  it("defers work of an archived Movie without writing", async () => {
    const seeded = await seedReview({ archivedMovie: true });
    await seedWork(seeded.reviewId);
    const before = await onlyWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h, seeded)).resolves.toBe("deferred");

    expect(h.provider.requests).toHaveLength(0);
    expect(await onlyWork(seeded.reviewId)).toEqual(before);
  });

  it("supersedes outstanding work of a Review that is no longer pending", async () => {
    const seeded = await seedReview({ state: "flagged" });
    await seedWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h, seeded)).resolves.toBe("not_current");

    expect(h.provider.requests).toHaveLength(0);
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "superseded" });
    expect(await review(seeded.reviewId)).toMatchObject({ moderation_state: "flagged" });
  });

  it("supersedes leftover work of an older content revision", async () => {
    const seeded = await seedReview({ contentRevision: 2 });
    await seedWork(seeded.reviewId, { contentRevision: 1 });
    await seedWork(seeded.reviewId, { contentRevision: 2 });
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h, seeded, 1)).resolves.toBe("not_current");

    expect(h.provider.requests).toHaveLength(0);
    expect((await workRows(seeded.reviewId)).map(({ content_revision, status }) => [content_revision, status])).toEqual([
      [1, "superseded"],
      [2, "pending"],
    ]);
  });
});

describe("races during the provider call (AI-02: late output never overrides)", () => {
  it("lets a human approval committed during the call win", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({
      script: [success(SUSPECTED)],
      duringCall: async () => {
        // A-04 stand-in: approval with a reason, committed by another instance.
        await owner.query(
          "UPDATE app.review SET moderation_state = 'cleared', clearance_source = 'admin', version = version + 1 WHERE id = $1",
          [seeded.reviewId],
        );
      },
    });

    await expect(attempt(h, seeded)).resolves.toBe("not_current");

    expect(await review(seeded.reviewId)).toMatchObject({ moderation_state: "cleared", clearance_source: "admin", version: 2 });
    expect(await count("review_moderation")).toBe(0);
    expect(await count("audit_entry")).toBe(0);
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "superseded", execution_count: 0 });
    expect(await jobs()).toEqual([expect.objectContaining({ status: "stale", error_code: "publish_stale" })]);
  });

  it("cancels work hidden during the call and publishes nothing", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({
      script: [success(CLEAN)],
      duringCall: async () => {
        await owner.query("UPDATE app.review SET hidden_at = now(), version = version + 1 WHERE id = $1", [seeded.reviewId]);
      },
    });

    await expect(attempt(h, seeded)).resolves.toBe("not_current");

    expect(await review(seeded.reviewId)).toMatchObject({ moderation_state: "pending" });
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "cancelled" });
  });

  it("rejects a late result for a body edited during the call and keeps the new revision's work", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const queue = createModerationWorkQueue({ sql: other });
    const h = harness({
      script: [success(CLEAN)],
      duringCall: async () => {
        // U-02 stand-in: a body edit under the Review lock, with K9 enqueue in the same Tx.
        await other.withTransaction(async (tx) => {
          await other.query(tx, "SELECT 1 FROM app.review WHERE id = $1 FOR UPDATE", [seeded.reviewId]);
          await other.query(
            tx,
            "UPDATE app.review SET body = 'Edited.', content_revision = 2, version = version + 1 WHERE id = $1",
            [seeded.reviewId],
          );
          await queue.enqueue(tx, seeded.reviewId, 2 as ContentRevision);
        });
      },
    });

    await expect(attempt(h, seeded)).resolves.toBe("not_current");

    expect(await review(seeded.reviewId)).toMatchObject({ moderation_state: "pending" });
    expect((await workRows(seeded.reviewId)).map(({ content_revision, status }) => [content_revision, status])).toEqual([
      [1, "superseded"],
      [2, "pending"],
    ]);
  });

  it("returns stale work to pending for a rating-only edit, without consuming an execution", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const h = harness({
      script: [success(CLEAN)],
      duringCall: async () => {
        await owner.query("UPDATE app.review SET rating = 3, version = version + 1 WHERE id = $1", [seeded.reviewId]);
      },
    });

    await expect(attempt(h, seeded)).resolves.toBe("not_current");

    const work = await onlyWork(seeded.reviewId);
    expect(work).toMatchObject({ status: "pending", execution_count: 0 });
    expect(work.last_attempt_at).not.toBeNull();
    expect(await review(seeded.reviewId)).toMatchObject({ moderation_state: "pending", version: 2 });
  });
});

describe("version change (D-49)", () => {
  it("supersedes pending work under an older policy and screens the current text under the current versions", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { policyVersion: "profanity-policy-v0" });

    await expect(attempt(harness({ script: [success(CLEAN)] }), seeded)).resolves.toBe("cleared");

    expect((await workRows(seeded.reviewId)).map(({ policy_version, status }) => [policy_version, status])).toEqual([
      ["profanity-policy-v0", "superseded"],
      [PROFANITY_POLICY_VERSION, "completed"],
    ]);
  });

  it("keeps needs_manual_review work under an older version and does not screen again", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { policyVersion: "profanity-policy-v0", status: "needs_manual_review" });
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h, seeded)).resolves.toBe("manual_review");

    expect(h.provider.requests).toHaveLength(0);
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "needs_manual_review" });
  });
});

describe("recovery of running work (D-77, D-101)", () => {
  it("defers while another execution's claim is live, with no provider call", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { status: "running", nextAttemptInSeconds: 60 });
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h, seeded)).resolves.toBe("deferred");

    expect(h.provider.requests).toHaveLength(0);
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "running", execution_count: 0 });
  });

  it("recovers a crashed execution's expired claim, counting it as one failed execution", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { status: "running", nextAttemptInSeconds: -1 });

    await expect(attempt(harness({ script: [success(CLEAN)] }), seeded)).resolves.toBe("cleared");

    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "completed", execution_count: 2 });
  });

  it("sends a Review whose executions keep crashing to manual review at the limit", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId, { status: "running", executionCount: 2, nextAttemptInSeconds: -1 });
    const h = harness({ script: [success(CLEAN)] });

    await expect(attempt(h, seeded)).resolves.toBe("manual_review");

    expect(h.provider.requests).toHaveLength(0);
    expect(await onlyWork(seeded.reviewId)).toMatchObject({ status: "needs_manual_review", execution_count: 3 });
  });

  it("claims work for 120 seconds while the provider is called", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    let during: WorkRow | undefined;
    const h = harness({
      script: [success(CLEAN)],
      duringCall: async () => {
        during = await onlyWork(seeded.reviewId);
      },
    });

    await attempt(h, seeded);

    expect(during).toMatchObject({ status: "running", execution_count: 0, model_id: MODEL_ID, last_attempt_at: null });
    expect(during!.next_in_seconds).toBeGreaterThanOrEqual(115);
    expect(during!.next_in_seconds).toBeLessThanOrEqual(125);
  });
});

describe("faults", () => {
  it("returns deferred and writes nothing when the claim Tx cannot start", async () => {
    const seeded = await seedReview();
    await seedWork(seeded.reviewId);
    const before = await onlyWork(seeded.reviewId);
    const h = harness({ script: [success(CLEAN)] });
    h.database.failNextTransaction();

    await expect(attempt(h, seeded)).resolves.toBe("deferred");

    expect(h.provider.requests).toHaveLength(0);
    expect(await onlyWork(seeded.reviewId)).toEqual(before);
  });
});
