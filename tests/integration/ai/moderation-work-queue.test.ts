import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import {
  createDeferredModerationDispatcher,
  createModerationWorkQueue,
  PROFANITY_POLICY_VERSION,
  REVIEW_SCREENING_PROMPT_VERSION,
  type ModerationWorkQueue,
} from "../../../src/server/services/ai/moderation";
import type { ContentRevision, ReviewId, Tx } from "../../../src/server/shared";
import {
  describeModerationWorkQueueContract,
  SEEDED_WORK_AT,
  type StoredWork,
  type WorkSeed,
} from "../../support/contracts/moderation-work-queue.contract";
import { connectAsOwner, insertAccount, insertMovie, insertReview } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";

const db: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const queue: ModerationWorkQueue = createModerationWorkQueue({ sql: db });

/** Seeds and inspects rows, and observes lock waits. */
let owner: Client;

beforeAll(async () => {
  owner = await connectAsOwner();
});

afterAll(async () => {
  await owner.end();
});

/**
 * Takes the D-58 precondition as K8 `lockReviewForTransition` will (D-20): an unlocked read of movie_id, then
 * the Movie and the Review `FOR UPDATE`. Runs as the least-privilege runtime role (D-32), as production does.
 */
async function lockReview(sql: Sql, tx: Tx, reviewId: ReviewId): Promise<void> {
  await sql.query(tx, "SET LOCAL ROLE app_runtime", []);
  const rows = await sql.query<{ movie_id: string }>(tx, "SELECT movie_id FROM app.review WHERE id = $1", [reviewId]);
  const movieId = rows[0]?.movie_id;
  if (movieId !== undefined) {
    await sql.query(tx, "SELECT 1 FROM app.movie WHERE id = $1 FOR UPDATE", [movieId]);
    await sql.query(tx, "SELECT 1 FROM app.review WHERE id = $1 FOR UPDATE", [reviewId]);
  }
}

function inReviewLockedTx<T>(reviewId: ReviewId, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.withTransaction(async (tx) => {
    await lockReview(db, tx, reviewId);
    return work(tx);
  });
}

async function seedReview(): Promise<ReviewId> {
  const movieId = await insertMovie(owner);
  const authorId = await insertAccount(owner);
  return (await insertReview(owner, movieId, authorId)) as ReviewId;
}

async function seedWork(reviewId: ReviewId, seed: WorkSeed): Promise<void> {
  await owner.query(
    `INSERT INTO app.moderation_work (review_id, content_revision, model_id, prompt_version, policy_version, status,
                                      execution_count, next_attempt_at, last_attempt_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $8)`,
    [
      reviewId,
      seed.contentRevision,
      seed.modelId ?? null,
      seed.promptVersion ?? REVIEW_SCREENING_PROMPT_VERSION,
      seed.policyVersion ?? PROFANITY_POLICY_VERSION,
      seed.status,
      seed.executionCount ?? 0,
      SEEDED_WORK_AT,
      seed.lastAttemptAt ?? null,
    ],
  );
}

async function storedWork(reviewId: ReviewId): Promise<readonly StoredWork[]> {
  const { rows } = await owner.query<{
    content_revision: number;
    model_id: string | null;
    prompt_version: string;
    policy_version: string;
    status: StoredWork["status"];
    execution_count: number;
    next_attempt_at: Date;
    last_attempt_at: Date | null;
    updated_at: Date;
  }>(
    `SELECT content_revision, model_id, prompt_version, policy_version, status, execution_count, next_attempt_at,
            last_attempt_at, updated_at
     FROM app.moderation_work WHERE review_id = $1
     ORDER BY content_revision, prompt_version COLLATE "C", policy_version COLLATE "C"`,
    [reviewId],
  );
  return rows.map((row) => ({
    contentRevision: row.content_revision,
    modelId: row.model_id,
    promptVersion: row.prompt_version,
    policyVersion: row.policy_version,
    status: row.status,
    executionCount: row.execution_count,
    nextAttemptAt: row.next_attempt_at,
    lastAttemptAt: row.last_attempt_at,
    updatedAt: row.updated_at,
  }));
}

/** Every row of every table K9 or the stub could touch, so a test can assert that nothing changed. */
async function snapshotTables(): Promise<unknown> {
  const tables = ["moderation_work", "review", "movie", "ai_job", "scheduler_lease", "ai_budget_day"];
  const snapshot: Record<string, unknown[]> = {};
  for (const table of tables) {
    const { rows } = await owner.query(`SELECT * FROM app.${table} ORDER BY 1`);
    snapshot[table] = rows;
  }
  return snapshot;
}

async function reviewRow(reviewId: ReviewId): Promise<unknown> {
  const { rows } = await owner.query("SELECT * FROM app.review WHERE id = $1", [reviewId]);
  return rows[0];
}

/** Waits until another session is blocked on a row lock, so a race test really races. */
async function waitForLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await owner.query<{ waiting: number }>(
      `SELECT count(*)::integer AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0]!.waiting > 0) {
      return;
    }
    await sleep(20);
  }
  throw new Error("no session waited for the row lock");
}

const truncate = () => owner.query("TRUNCATE app.moderation_work, app.review, app.movie, app.account CASCADE");

describeModerationWorkQueueContract("PostgreSQL", async () => {
  await truncate();
  return {
    queue,
    seedReview,
    missingReviewId: () => randomUUID() as ReviewId,
    seedWork,
    inReviewLockedTx,
    storedWork,
  };
});

describe("ModerationWork queue — PostgreSQL concurrency (D-50, D-58)", () => {
  beforeEach(truncate);

  it("two clients enqueueing the same revision under the Review lock leave exactly one row", async () => {
    const reviewId = await seedReview();
    const second = createDatabase({ url: testDatabaseUrl(), caCert: null });
    const secondQueue = createModerationWorkQueue({ sql: second });

    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstEnqueued!: () => void;
    const enqueued = new Promise<void>((resolve) => {
      firstEnqueued = resolve;
    });

    const first = db.withTransaction(async (tx) => {
      await lockReview(db, tx, reviewId);
      await queue.enqueue(tx, reviewId, 1 as ContentRevision);
      firstEnqueued();
      await released;
    });
    await enqueued;
    const racing = second.withTransaction(async (tx) => {
      await lockReview(second, tx, reviewId);
      await secondQueue.enqueue(tx, reviewId, 1 as ContentRevision);
    });
    await waitForLockWait();
    release();

    await Promise.all([first, racing]);
    expect(await storedWork(reviewId)).toMatchObject([{ contentRevision: 1, status: "pending", modelId: null }]);
  });

  it("many parallel enqueues of the same revision under the Review lock leave exactly one row", async () => {
    const reviewId = await seedReview();
    const second = createDatabase({ url: testDatabaseUrl(), caCert: null });
    const secondQueue = createModerationWorkQueue({ sql: second });
    const enqueueOn = (database: Database & Sql, workQueue: ModerationWorkQueue) =>
      database.withTransaction(async (tx) => {
        await lockReview(database, tx, reviewId);
        await workQueue.enqueue(tx, reviewId, 2 as ContentRevision);
      });

    await Promise.all([
      enqueueOn(db, queue),
      enqueueOn(second, secondQueue),
      enqueueOn(db, queue),
      enqueueOn(second, secondQueue),
    ]);

    expect(await storedWork(reviewId)).toHaveLength(1);
  });
});

describe("ModerationWork queue — PostgreSQL transactions and side effects (D-50)", () => {
  beforeEach(truncate);

  it("enqueue rolls back with the caller's Tx, including the supersession", async () => {
    const reviewId = await seedReview();
    await seedWork(reviewId, { contentRevision: 1, status: "pending" });
    const before = await storedWork(reviewId);
    const failure = new Error("synthetic review write failure");

    await expect(
      inReviewLockedTx(reviewId, async (tx) => {
        await queue.enqueue(tx, reviewId, 2 as ContentRevision);
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await storedWork(reviewId)).toEqual(before);
  });

  it("cancelForDeletedReview rolls back with the caller's Tx", async () => {
    const reviewId = await seedReview();
    await seedWork(reviewId, { contentRevision: 1, status: "running", modelId: "synthetic-model" });
    const before = await storedWork(reviewId);
    const failure = new Error("synthetic deletion failure");

    await expect(
      inReviewLockedTx(reviewId, async (tx) => {
        await queue.cancelForDeletedReview(tx, reviewId);
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await storedWork(reviewId)).toEqual(before);
  });

  it("an unknown Review fails the caller's Tx with the foreign key violation", async () => {
    const missing = randomUUID() as ReviewId;

    await expect(
      inReviewLockedTx(missing, (tx) => queue.enqueue(tx, missing, 1 as ContentRevision)),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("enqueue and cancel never change the Review row", async () => {
    const reviewId = await seedReview();
    await seedWork(reviewId, { contentRevision: 1, status: "pending" });
    const before = await reviewRow(reviewId);

    await inReviewLockedTx(reviewId, (tx) => queue.enqueue(tx, reviewId, 2 as ContentRevision));
    await inReviewLockedTx(reviewId, (tx) => queue.cancelForDeletedReview(tx, reviewId));

    expect(await reviewRow(reviewId)).toEqual(before);
  });
});

describe("deferred moderation dispatcher — PostgreSQL (D-52)", () => {
  beforeEach(truncate);

  it("returns deferred and changes no row", async () => {
    const reviewId = await seedReview();
    await seedWork(reviewId, { contentRevision: 1, status: "pending" });
    await seedWork(reviewId, { contentRevision: 1, status: "cancelled", promptVersion: "review-screening-prompt-v0" });
    const before = await snapshotTables();

    const dispatcher = createDeferredModerationDispatcher();
    expect(await dispatcher.attemptAfterCommit(reviewId, 1 as ContentRevision)).toBe("deferred");
    expect(await dispatcher.attemptAfterCommit(randomUUID() as ReviewId, 1 as ContentRevision)).toBe("deferred");

    expect(await snapshotTables()).toEqual(before);
  });
});
