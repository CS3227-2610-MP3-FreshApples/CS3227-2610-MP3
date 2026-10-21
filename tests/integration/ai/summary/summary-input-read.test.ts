import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../../src/server/db";
import { createPublicMovieReadRepository } from "../../../../src/server/repositories/catalogue";
import { createSummaryInputRepository } from "../../../../src/server/repositories/summary";
import { createSummaryInputPreparation, SUMMARY_PROMPT_VERSION } from "../../../../src/server/services/ai/summary";
import { createMovieLocks, createReviewsChangedMarker } from "../../../../src/server/services/catalogue";
import type { MovieId, Tx } from "../../../../src/server/shared";
import { connectAsOwner, insertAccount, insertMovie } from "../../database/schema-fixtures";
import { testDatabaseUrl } from "../../database/test-database";

const db: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const inputs = createSummaryInputRepository({ sql: db });
const publicMovies = createPublicMovieReadRepository({ sql: db });
// The pool holds one connection, so the concurrent review writer uses its own database instance.
const writerDb: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const writerLocks = createMovieLocks({ sql: writerDb });
const writerMarker = createReviewsChangedMarker({ sql: writerDb });
const SEED = Buffer.alloc(32, 0x5a);

let owner: Client;

beforeAll(async () => {
  owner = await connectAsOwner();
});

afterAll(async () => {
  await owner.end();
});

beforeEach(async () => {
  await owner.query("TRUNCATE app.review_summary, app.ai_job, app.review, app.movie, app.account CASCADE");
});

/** Runs as the least-privilege runtime role (D-32), as production does. */
function inRuntimeTx<T>(work: (tx: Tx) => Promise<T>, database: Database & Sql = db): Promise<T> {
  return database.withTransaction(async (tx) => {
    await database.query(tx, "SET LOCAL ROLE app_runtime", []);
    return work(tx);
  });
}

function readSnapshot(movieId: string, promptVersion = SUMMARY_PROMPT_VERSION) {
  return inRuntimeTx((tx) => inputs.readSnapshot(tx, movieId as MovieId, promptVersion));
}

interface ReviewSeed {
  readonly count: number;
  readonly moderationState?: "pending" | "flagged" | "cleared";
  readonly hidden?: boolean;
  readonly deleted?: boolean;
  readonly contentRevision?: number;
  readonly version?: number;
}

/** Inserts `count` synthetic Reviews, each by a new synthetic account; returns their IDs. */
async function seedReviews(movieId: string, seed: ReviewSeed): Promise<string[]> {
  const { rows } = await owner.query<{ id: string }>(
    `WITH authors AS (
       INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
       SELECT gen_random_uuid() || '@example.test', 'synthetic-hash', 'Synthetic', 'USER', 'active'
       FROM generate_series(1, $2::integer)
       RETURNING id
     )
     INSERT INTO app.review
       (movie_id, author_id, rating, body, moderation_state, hidden_at, deleted_at, content_revision, version,
        clearance_source)
     SELECT $1, id, 1 + (row_number() OVER () % 10)::integer, 'Synthetic body ' || row_number() OVER (), $3,
            CASE WHEN $4 THEN now() END, CASE WHEN $5 THEN now() END, $6, $7,
            CASE WHEN $3 = 'cleared' THEN 'ai' END
     FROM authors
     RETURNING id`,
    [
      movieId,
      seed.count,
      seed.moderationState ?? "cleared",
      seed.hidden ?? false,
      seed.deleted ?? false,
      seed.contentRevision ?? 1,
      seed.version ?? 1,
    ],
  );
  return rows.map(({ id }) => id);
}

async function insertSummary(movieId: string, revision: number, promptVersion: string): Promise<void> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app.ai_job (type, trigger, subject_id, input_revision, dedup_key, status, lease_until, expires_at,
                             model_id, prompt_version, input_hash)
     VALUES ('summary', 'scheduler', $1, $2, $3, 'succeeded', now(), now() + interval '7 days',
             'synthetic-model', $4, 'synthetic-hash')
     RETURNING id`,
    [movieId, revision, randomUUID(), promptVersion],
  );
  await owner.query(
    `INSERT INTO app.review_summary
       (job_id, movie_id, reviews_revision, sampled_review_ids_and_versions, eligible_count, output_json, generated_at)
     VALUES ($1, $2, $3, '{}'::jsonb, 3, '{}'::jsonb, now())`,
    [rows[0]?.id, movieId, revision],
  );
}

async function setRevision(movieId: string, revision: number): Promise<void> {
  await owner.query("UPDATE app.movie SET reviews_revision = $2 WHERE id = $1", [movieId, revision]);
}

describe("D-86 consistent summary read", () => {
  it("returns null for a missing Movie and an archived Movie", async () => {
    const archived = await insertMovie(owner);
    await seedReviews(archived, { count: 4 });
    await owner.query("UPDATE app.movie SET archived_at = now() WHERE id = $1", [archived]);

    await expect(readSnapshot(randomUUID())).resolves.toBeNull();
    await expect(readSnapshot(archived)).resolves.toBeNull();
  });

  it("returns an active Movie with no Reviews as an empty snapshot at its revision", async () => {
    const movieId = await insertMovie(owner);
    await setRevision(movieId, 6);

    await expect(readSnapshot(movieId)).resolves.toEqual({ reviewsRevision: 6, hasCurrentSummary: false, reviews: [] });
  });

  it("returns every eligible Review's ID, version, content revision, rating and body in ascending ID order", async () => {
    const movieId = await insertMovie(owner);
    const ids = await seedReviews(movieId, { count: 5, version: 3, contentRevision: 2 });
    const { rows } = await owner.query<{ id: string; rating: number; body: string }>(
      "SELECT id, rating, body FROM app.review WHERE movie_id = $1 ORDER BY id",
      [movieId],
    );

    const snapshot = await readSnapshot(movieId);

    expect(snapshot?.reviews.map(({ id }) => id)).toEqual([...ids].sort());
    expect(snapshot?.reviews).toEqual(
      rows.map((row) => ({ id: row.id, version: 3, contentRevision: 2, rating: row.rating, body: row.body })),
    );
  });

  it("reads only the given Movie's Reviews", async () => {
    const movieId = await insertMovie(owner);
    const other = await insertMovie(owner);
    await seedReviews(movieId, { count: 3 });
    await seedReviews(other, { count: 4 });

    expect((await readSnapshot(movieId))?.reviews).toHaveLength(3);
  });

  // Distinct powers of two per state, so a wrongly included or excluded state cannot cancel out (D-93).
  it("counts the same eligible Reviews as the U-01 public reviewCount in every eligibility state (D-86 parity)", async () => {
    const movieId = await insertMovie(owner);
    await seedReviews(movieId, { count: 1 });
    await seedReviews(movieId, { count: 2, moderationState: "pending" });
    await seedReviews(movieId, { count: 4, moderationState: "flagged" });
    await seedReviews(movieId, { count: 8, hidden: true });
    await seedReviews(movieId, { count: 16, deleted: true });
    await seedReviews(movieId, { count: 32, hidden: true, deleted: true });
    await seedReviews(movieId, { count: 64, contentRevision: 3 });

    const snapshot = await readSnapshot(movieId);
    const detail = await inRuntimeTx((tx) => publicMovies.findActiveById(tx, movieId as MovieId));

    expect(snapshot?.reviews).toHaveLength(65);
    expect(detail?.reviewCount).toBe(65);
  });

  it("reports a current summary only at the Movie's revision and the current prompt version (D-88, D-93)", async () => {
    const atRevision = await insertMovie(owner);
    const olderRevision = await insertMovie(owner);
    const olderPrompt = await insertMovie(owner);
    const otherMovie = await insertMovie(owner);
    for (const movieId of [atRevision, olderRevision, olderPrompt, otherMovie]) {
      await setRevision(movieId, 5);
    }
    await insertSummary(atRevision, 5, SUMMARY_PROMPT_VERSION);
    await insertSummary(olderRevision, 4, SUMMARY_PROMPT_VERSION);
    await insertSummary(olderPrompt, 5, "review-summary-prompt-v0");
    await insertSummary(atRevision, 5, "review-summary-prompt-v0");

    await expect(readSnapshot(atRevision)).resolves.toMatchObject({ hasCurrentSummary: true });
    await expect(readSnapshot(olderRevision)).resolves.toMatchObject({ hasCurrentSummary: false });
    await expect(readSnapshot(olderPrompt)).resolves.toMatchObject({ hasCurrentSummary: false });
    await expect(readSnapshot(otherMovie)).resolves.toMatchObject({ hasCurrentSummary: false });
    await expect(readSnapshot(olderPrompt, "review-summary-prompt-v0")).resolves.toMatchObject({
      hasCurrentSummary: true,
    });
  });

  it("sees the revision and the Review set from one snapshot around a K7 review change", async () => {
    const movieId = await insertMovie(owner);
    await seedReviews(movieId, { count: 3 });
    await setRevision(movieId, 2);
    const authorId = await insertAccount(owner);

    let releaseWriter!: () => void;
    const writerMayCommit = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    let signalWritten!: () => void;
    const written = new Promise<void>((resolve) => {
      signalWritten = resolve;
    });
    // A stand-in for a U-02 review create (D-91): insert a cleared Review and advance the revision through K7.
    const writer = inRuntimeTx(async (tx) => {
      const lock = await writerLocks.lockActiveMovieForUpdate(tx, movieId as MovieId);
      if (!lock.ok) {
        throw new Error("movie unavailable");
      }
      await writerDb.query(
        tx,
        `INSERT INTO app.review (movie_id, author_id, rating, body, moderation_state, clearance_source)
         VALUES ($1, $2, 9, 'Synthetic late body', 'cleared', 'ai')`,
        [movieId, authorId],
      );
      await writerMarker.markReviewsChanged(tx, lock.value);
      signalWritten();
      await writerMayCommit;
    }, writerDb);
    await written;

    // The writer holds the Movie row lock; the read takes no lock, so it must not wait.
    const during = await inRuntimeTx(async (tx) => {
      await db.query(tx, "SET LOCAL lock_timeout = '1s'", []);
      return inputs.readSnapshot(tx, movieId as MovieId, SUMMARY_PROMPT_VERSION);
    }).finally(releaseWriter);
    await writer;
    const after = await readSnapshot(movieId);

    expect(during?.reviewsRevision).toBe(2);
    expect(during?.reviews).toHaveLength(3);
    expect(after?.reviewsRevision).toBe(3);
    expect(after?.reviews).toHaveLength(4);
  });
});

describe("summary input preparation against PostgreSQL (AI-01 item 3, D-93 L5)", () => {
  const service = createSummaryInputPreparation({
    database: db,
    inputs,
    limits: { sampleSize: 20, inputTokenLimit: 8_000 },
    seedSource: () => SEED,
  });

  async function executionRecordCounts(): Promise<{ jobs: number; reservations: number; summaries: number }> {
    const { rows } = await owner.query<{ jobs: number; reservations: number; summaries: number }>(
      `SELECT (SELECT count(*)::integer FROM app.ai_job) AS jobs,
              (SELECT count(*)::integer FROM app.ai_budget_reservation) AS reservations,
              (SELECT count(*)::integer FROM app.review_summary) AS summaries`,
    );
    return rows[0] ?? { jobs: -1, reservations: -1, summaries: -1 };
  }

  it.each([0, 1, 2])("returns insufficient_reviews for %i eligible Reviews and writes nothing", async (n) => {
    const movieId = await insertMovie(owner);
    await seedReviews(movieId, { count: n });
    await seedReviews(movieId, { count: 5, moderationState: "pending" });
    const { rows: before } = await owner.query("SELECT * FROM app.movie WHERE id = $1", [movieId]);

    await expect(service.prepare(movieId as MovieId)).resolves.toEqual({
      kind: "insufficient_reviews",
      eligibleCount: n,
    });

    await expect(executionRecordCounts()).resolves.toEqual({ jobs: 0, reservations: 0, summaries: 0 });
    const { rows: after } = await owner.query("SELECT * FROM app.movie WHERE id = $1", [movieId]);
    expect(after).toEqual(before);
  });

  it("returns unavailable for an archived Movie", async () => {
    const movieId = await insertMovie(owner);
    await seedReviews(movieId, { count: 5 });
    await owner.query("UPDATE app.movie SET archived_at = now() WHERE id = $1", [movieId]);

    await expect(service.prepare(movieId as MovieId)).resolves.toEqual({ kind: "unavailable" });
  });

  it("prepares a bounded sample of 20 from 21 eligible Reviews at the read revision without writing", async () => {
    const movieId = await insertMovie(owner);
    const eligible = await seedReviews(movieId, { count: 21, version: 2, contentRevision: 2 });
    await seedReviews(movieId, { count: 3, hidden: true });
    await setRevision(movieId, 9);

    const result = await service.prepare(movieId as MovieId);

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") {
      return;
    }
    expect(result.reviewsRevision).toBe(9);
    expect(result.eligibleCount).toBe(21);
    expect(result.sample.seed).toBe(SEED.toString("hex"));
    expect(result.sample.reviews).toHaveLength(20);
    expect(new Set(result.sample.reviews.map(({ reviewId }) => reviewId)).size).toBe(20);
    expect(result.sample.reviews.every(({ reviewId }) => eligible.includes(reviewId))).toBe(true);
    expect(result.sample.reviews.every(({ version, contentRevision }) => version === 2 && contentRevision === 2)).toBe(
      true,
    );
    await expect(executionRecordCounts()).resolves.toEqual({ jobs: 0, reservations: 0, summaries: 0 });
  });

  it("returns current when a summary exists at the current revision and prompt version", async () => {
    const movieId = await insertMovie(owner);
    await seedReviews(movieId, { count: 4 });
    await setRevision(movieId, 3);
    await insertSummary(movieId, 3, SUMMARY_PROMPT_VERSION);

    await expect(service.prepare(movieId as MovieId)).resolves.toEqual({ kind: "current" });
  });
});
