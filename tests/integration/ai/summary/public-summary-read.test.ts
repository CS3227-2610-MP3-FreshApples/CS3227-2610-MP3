import { randomBytes, randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { MARKER_FAKE_SUMMARY_OUTPUT } from "../../../../src/server/adapters/soc-llm/marker-fake-provider";
import { createDatabase, type Database, type Sql } from "../../../../src/server/db";
import { createPublicMovieReadRepository } from "../../../../src/server/repositories/catalogue";
import { createReviewRepository } from "../../../../src/server/repositories/reviews";
import { createPublicSummaryReadRepository } from "../../../../src/server/repositories/summary";
import {
  createPublicSummaryReadService,
  SUMMARY_PROMPT_VERSION,
  type PublicSummaryReadService,
} from "../../../../src/server/services/ai/summary";
import { createMovieLocks, createReviewsChangedMarker } from "../../../../src/server/services/catalogue";
import type { MovieId } from "../../../../src/server/shared";
import { createLoginRole, dropLoginRole } from "../../../setup/test-database.mjs";
import { connectAsOwner } from "../../database/schema-fixtures";
import { testDatabaseUrl } from "../../database/test-database";

// The D-90 public read (as amended by D-93, D-94 and D-98) against PostgreSQL, as the least-privilege runtime role.
// Review rows are synthetic stand-ins for U-02 (D-91); the revision advances through the real K7 marker.

const RUNTIME_ROLE = `mp3_summary_read_${randomBytes(4).toString("hex")}`;
const RUNTIME_PASSWORD = randomBytes(24).toString("hex");
const OLDER_PROMPT_VERSION = "review-summary-prompt-v0";

let owner: Client;
let app: Database & Sql;
let skipped: string[];
let service: PublicSummaryReadService;

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
  await owner.query(
    `TRUNCATE app.review_summary, app.ai_budget_reservation, app.ai_job, app.ai_budget_day, app.scheduler_lease,
       app.rate_limit_window, app.review, app.movie, app.account CASCADE`,
  );
  skipped = [];
  service = createPublicSummaryReadService({
    database: app,
    summaries: createPublicSummaryReadRepository({ sql: app }),
    log: { invalidStoredOutput: (_movieId, summaryId) => void skipped.push(summaryId) },
  });
});

async function seedMovie(archived = false): Promise<MovieId> {
  const { rows } = await owner.query<{ id: MovieId }>(
    `INSERT INTO app.movie (title, synopsis, director, reviews_revision, archived_at)
     VALUES ('Synthetic Movie', 'Synthetic synopsis.', '', 3, CASE WHEN $1 THEN now() END) RETURNING id`,
    [archived],
  );
  return rows[0]!.id;
}

interface ReviewSeed {
  readonly moderationState?: "pending" | "flagged" | "cleared";
  readonly hidden?: boolean;
  readonly deleted?: boolean;
  readonly contentRevision?: number;
}

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
     SELECT $1, id, 6, 'Synthetic review body.', $3, CASE WHEN $4 THEN now() END, CASE WHEN $5 THEN now() END, $6,
            CASE WHEN $3 = 'cleared' THEN 'ai' END
     FROM authors`,
    [movieId, count, seed.moderationState ?? "cleared", seed.hidden ?? false, seed.deleted ?? false, seed.contentRevision ?? 1],
  );
}

function sampleJson(count: number, truncated = false): string {
  return JSON.stringify({
    algorithm: "summary-sample-v1",
    seed: "cd".repeat(32),
    sampledCount: count,
    reviews: Array.from({ length: count }, () => ({ reviewId: randomUUID(), version: 1, contentRevision: 1, truncated })),
  });
}

/** A succeeded job and its ReviewSummary, as an earlier generation wrote them. */
async function insertSummary(
  movieId: MovieId,
  options: {
    readonly revisionOffset?: number;
    readonly promptVersion?: string;
    readonly output?: string;
    readonly sample?: string;
    readonly generatedAt?: string;
    readonly id?: string;
  } = {},
): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app.ai_job (type, trigger, subject_id, input_revision, dedup_key, status, lease_until, expires_at,
                             model_id, prompt_version, input_hash)
     SELECT 'summary', 'scheduler', id, reviews_revision + $2, $3, 'succeeded', now(), now() + interval '7 days',
            'synthetic-model', $4, 'synthetic-hash'
     FROM app.movie WHERE id = $1
     RETURNING id`,
    [movieId, options.revisionOffset ?? 0, randomUUID(), options.promptVersion ?? SUMMARY_PROMPT_VERSION],
  );
  const inserted = await owner.query<{ id: string }>(
    `INSERT INTO app.review_summary
       (id, job_id, movie_id, reviews_revision, sampled_review_ids_and_versions, eligible_count, output_json, generated_at)
     SELECT COALESCE($7::uuid, gen_random_uuid()), $1, id, reviews_revision + $3, $4::jsonb, 3, $5::jsonb,
            COALESCE($6::timestamptz, now())
     FROM app.movie WHERE id = $2
     RETURNING id`,
    [
      rows[0]!.id,
      movieId,
      options.revisionOffset ?? 0,
      options.sample ?? sampleJson(3),
      options.output ?? MARKER_FAKE_SUMMARY_OUTPUT,
      options.generatedAt ?? null,
      options.id ?? null,
    ],
  );
  return inserted.rows[0]!.id;
}

const OUTPUT = JSON.parse(MARKER_FAKE_SUMMARY_OUTPUT) as { overall: string };

describe("public summary read against PostgreSQL (D-90, D-98)", () => {
  it("returns null for a missing Movie and for an archived Movie with a summary", async () => {
    const archived = await seedMovie(true);
    await seedReviews(archived, 3);
    await insertSummary(archived);
    await expect(service.getSummary(randomUUID() as MovieId)).resolves.toBeNull();
    await expect(service.getSummary(archived)).resolves.toBeNull();
  });

  it("is ready at the current revision and prompt version, with counts and time from the stored row", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 5);
    await insertSummary(movieId, { sample: sampleJson(4, true), generatedAt: "2026-10-20T08:00:05.123+08:00" });

    await expect(service.getSummary(movieId)).resolves.toEqual({
      status: "ready",
      eligibleCount: 5,
      summary: {
        overall: OUTPUT.overall,
        strengths: expect.any(Array),
        criticisms: expect.any(Array),
        mixedOpinions: expect.any(Array),
        includedCount: 4,
        truncated: true,
        generatedAt: "2026-10-20T00:00:05.123Z",
      },
    });
  });

  it("becomes stale immediately when the revision advances, without any old text (AT-08 synthetic, D-91)", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 3);
    await insertSummary(movieId);
    expect((await service.getSummary(movieId))?.status).toBe("ready");

    const locks = createMovieLocks({ sql: app });
    const marker = createReviewsChangedMarker({ sql: app });
    await app.withTransaction(async (tx) => {
      const lock = await locks.lockActiveMovieForUpdate(tx, movieId);
      if (!lock.ok) throw new Error("movie not lockable");
      await marker.markReviewsChanged(tx, lock.value);
    });

    const view = await service.getSummary(movieId);
    expect(view).toEqual({ status: "stale", eligibleCount: 3 });
    expect(JSON.stringify(view)).not.toContain(OUTPUT.overall);
  });

  it("is stale when the only summary at the current revision has an older prompt version (D-93)", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 3);
    await insertSummary(movieId, { promptVersion: OLDER_PROMPT_VERSION });
    await expect(service.getSummary(movieId)).resolves.toEqual({ status: "stale", eligibleCount: 3 });
  });

  it("is missing when the Movie has never had a summary", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 3);
    await expect(service.getSummary(movieId)).resolves.toEqual({ status: "missing", eligibleCount: 3 });
  });

  it("is insufficient_reviews below 3 eligible Reviews even with a current summary", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 2);
    await seedReviews(movieId, 4, { moderationState: "pending" });
    await insertSummary(movieId);
    await expect(service.getSummary(movieId)).resolves.toEqual({ status: "insufficient_reviews", eligibleCount: 2 });
  });

  it("uses the latest current row by generated_at, then id (D-94 tie-break)", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 3);
    const output = (overall: string) => JSON.stringify({ ...JSON.parse(MARKER_FAKE_SUMMARY_OUTPUT), overall });
    await insertSummary(movieId, { output: output("Oldest."), generatedAt: "2026-10-19T00:00:00Z" });
    await insertSummary(movieId, { output: output("Same time, lower id."), generatedAt: "2026-10-20T00:00:00Z", id: "00000000-0000-4000-8000-0000000000aa" });
    await insertSummary(movieId, { output: output("Same time, higher id."), generatedAt: "2026-10-20T00:00:00Z", id: "ffffffff-0000-4000-8000-0000000000aa" });

    const view = await service.getSummary(movieId);
    expect(view?.status === "ready" && view.summary.overall).toBe("Same time, higher id.");
  });

  it("skips an invalid stored row without failing, and never exposes it (D-94 L7)", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 3);
    const invalidId = await insertSummary(movieId, {
      output: JSON.stringify({ ...JSON.parse(MARKER_FAKE_SUMMARY_OUTPUT), overall: "Fabricated <b>text</b>." }),
    });

    const view = await service.getSummary(movieId);
    expect(view).toEqual({ status: "stale", eligibleCount: 3 });
    expect(skipped).toEqual([invalidId]);
  });

  it("writes nothing and creates no AI job", async () => {
    const movieId = await seedMovie();
    await seedReviews(movieId, 3);
    const before = await owner.query("SELECT * FROM app.movie WHERE id = $1", [movieId]);
    await service.getSummary(movieId);
    await service.getSummary(movieId);
    expect((await owner.query("SELECT * FROM app.movie WHERE id = $1", [movieId])).rows).toEqual(before.rows);
    const { rows } = await owner.query("SELECT count(*)::integer AS n FROM app.ai_job");
    expect(rows[0]).toEqual({ n: 0 });
  });

  it("counts eligibleCount exactly as U-01 reviewCount and the U-02 public listing (D-94 M3, D-95)", async () => {
    const movieId = await seedMovie();
    // Distinct counts per state, so a wrongly included or excluded state cannot cancel out (D-93).
    await seedReviews(movieId, 1);
    await seedReviews(movieId, 2, { moderationState: "pending" });
    await seedReviews(movieId, 4, { moderationState: "flagged" });
    await seedReviews(movieId, 8, { hidden: true });
    await seedReviews(movieId, 16, { deleted: true });
    await seedReviews(movieId, 32, { hidden: true, deleted: true });
    await seedReviews(movieId, 64, { contentRevision: 3 });

    const view = await service.getSummary(movieId);
    const [detail, listing] = await app.withTransaction(async (tx) => [
      await createPublicMovieReadRepository({ sql: app }).findActiveById(tx, movieId),
      await createReviewRepository({ sql: app }).listPublic(tx, movieId, 1, 1),
    ] as const);

    expect(view?.eligibleCount).toBe(65);
    expect(detail?.reviewCount).toBe(65);
    expect(listing?.total).toBe(65);
  });
});
