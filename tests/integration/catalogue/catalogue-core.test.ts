import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import {
  createMovieLocks,
  createReviewsChangedMarker,
  createSummarySchedule,
  type MovieLocks,
  type ReviewsChangedMarker,
} from "../../../src/server/services/catalogue";
import type { MovieId, Tx } from "../../../src/server/shared";
import {
  describeCatalogueCoreContract,
  type MovieSeed,
  type StoredMovie,
} from "../../support/contracts/catalogue-core.contract";
import { connectAsOwner, expectViolation } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";

const LOCK_NOT_AVAILABLE = "55P03";
/** A seeded `updated_at`, before any test run, so any write is visible. */
const SEEDED_UPDATED_AT = new Date("2026-01-01T00:00:00.000Z");

const db: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const locks: MovieLocks = createMovieLocks({ sql: db });
const marker: ReviewsChangedMarker = createReviewsChangedMarker({ sql: db });
const schedule = createSummarySchedule({ sql: db });

/** The archiving session in race tests, and a second session that observes lock waits and holds locks. */
let owner: Client;
let observer: Client;

beforeAll(async () => {
  owner = await connectAsOwner();
  observer = await connectAsOwner();
});

afterAll(async () => {
  await owner.end();
  await observer.end();
});

/** Runs K7 as the least-privilege runtime role (D-32), as production does. */
async function asRuntime(tx: Tx): Promise<void> {
  await db.query(tx, "SET LOCAL ROLE app_runtime", []);
}

function inRuntimeTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.withTransaction(async (tx) => {
    await asRuntime(tx);
    return work(tx);
  });
}

async function seedMovie(seed: MovieSeed = {}): Promise<MovieId> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app.movie (title, synopsis, director, archived_at, reviews_revision, summary_pending_since,
                            summary_next_attempt_at, summary_last_attempt_at, created_at, updated_at)
     VALUES ('Synthetic Movie', 'Synthetic synopsis.', '', CASE WHEN $1 THEN $7::timestamptz END, $2, $3, $4, $5,
             $6, $6)
     RETURNING id`,
    [
      seed.archived ?? false,
      seed.reviewsRevision ?? 0,
      seed.summaryPendingSince ?? null,
      seed.summaryNextAttemptAt ?? null,
      seed.summaryLastAttemptAt ?? null,
      SEEDED_UPDATED_AT,
      SEEDED_UPDATED_AT,
    ],
  );
  return rows[0]!.id as MovieId;
}

async function stored(movieId: MovieId): Promise<StoredMovie> {
  const { rows } = await owner.query<{
    archived: boolean;
    reviews_revision: number;
    version: number;
    summary_pending_since: Date | null;
    summary_next_attempt_at: Date | null;
    summary_last_attempt_at: Date | null;
    summary_last_success_at: Date | null;
    updated_at: Date;
  }>(
    `SELECT archived_at IS NOT NULL AS archived, reviews_revision, version, summary_pending_since,
            summary_next_attempt_at, summary_last_attempt_at, summary_last_success_at, updated_at
     FROM app.movie WHERE id = $1`,
    [movieId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error("movie not stored");
  }
  return {
    archived: row.archived,
    reviewsRevision: row.reviews_revision,
    version: row.version,
    summaryPendingSince: row.summary_pending_since,
    summaryNextAttemptAt: row.summary_next_attempt_at,
    summaryLastAttemptAt: row.summary_last_attempt_at,
    summaryLastSuccessAt: row.summary_last_success_at,
    updatedAt: row.updated_at,
  };
}

/** Waits until another session is blocked on a row lock, so a race test really races. */
async function waitForLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await observer.query<{ waiting: number }>(
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

/** Archives the Movie in an open transaction on `owner`, the way the Admin archive path would. */
async function beginArchive(movieId: MovieId): Promise<void> {
  await owner.query("BEGIN");
  await owner.query(
    "UPDATE app.movie SET archived_at = now(), version = version + 1, updated_at = now() WHERE id = $1",
    [movieId],
  );
}

describeCatalogueCoreContract("PostgreSQL", async () => {
  await owner.query("TRUNCATE app.movie CASCADE");
  return {
    locks,
    marker,
    schedule,
    seedMovie,
    missingMovieId: () => randomUUID() as MovieId,
    inTx: inRuntimeTx,
    stored,
  };
});

describe("Catalogue core — PostgreSQL archive races (D-51, FR-05)", () => {
  beforeEach(async () => {
    await owner.query("TRUNCATE app.movie CASCADE");
  });

  it("a review-style Tx racing an archive gets archived, not not_found, and marks nothing", async () => {
    const movieId = await seedMovie({ reviewsRevision: 2 });
    await beginArchive(movieId);

    const review = db.withTransactionResult(async (tx) => {
      await asRuntime(tx);
      const locked = await locks.lockActiveMovieForUpdate(tx, movieId);
      if (!locked.ok) {
        return locked;
      }
      return { ok: true as const, value: await marker.markReviewsChanged(tx, locked.value) };
    });
    await waitForLockWait();
    await owner.query("COMMIT");

    expect(await review).toEqual({ ok: false, error: { kind: "archived" } });
    expect(await stored(movieId)).toMatchObject({ archived: true, reviewsRevision: 2, summaryPendingSince: null });
  });

  it("lockActiveMovieShared racing an archive also gets archived", async () => {
    const movieId = await seedMovie();
    await beginArchive(movieId);

    const report = inRuntimeTx((tx) => locks.lockActiveMovieShared(tx, movieId));
    await waitForLockWait();
    await owner.query("COMMIT");

    expect(await report).toEqual({ ok: false, error: { kind: "archived" } });
  });

  it("lockMovieForUpdate racing an archive returns the archived state", async () => {
    const movieId = await seedMovie({ reviewsRevision: 1 });
    await beginArchive(movieId);

    const admin = inRuntimeTx((tx) => locks.lockMovieForUpdate(tx, movieId));
    await waitForLockWait();
    await owner.query("COMMIT");

    expect(await admin).toEqual({ ok: true, value: { movieId, archived: true, reviewsRevision: 1 } });
  });

  it("gets the active Movie when the racing archive rolls back", async () => {
    const movieId = await seedMovie();
    await beginArchive(movieId);

    const review = inRuntimeTx((tx) => locks.lockActiveMovieForUpdate(tx, movieId));
    await waitForLockWait();
    await owner.query("ROLLBACK");

    expect(await review).toEqual({ ok: true, value: { movieId, archived: false, reviewsRevision: 0 } });
  });
});

describe("Catalogue core — PostgreSQL row locks", () => {
  beforeEach(async () => {
    await owner.query("TRUNCATE app.movie CASCADE");
  });

  async function expectRowLockedAgainst(movieId: MovieId, lockClause: string): Promise<void> {
    await expectViolation(
      observer.query(`SELECT 1 FROM app.movie WHERE id = $1 ${lockClause} NOWAIT`, [movieId]),
      LOCK_NOT_AVAILABLE,
    );
  }

  it("lockActiveMovieForUpdate holds FOR UPDATE until the Tx ends", async () => {
    const movieId = await seedMovie();

    await inRuntimeTx(async (tx) => {
      await locks.lockActiveMovieForUpdate(tx, movieId);
      await expectRowLockedAgainst(movieId, "FOR SHARE");
    });

    await expect(observer.query("SELECT 1 FROM app.movie WHERE id = $1 FOR UPDATE NOWAIT", [movieId])).resolves.toBeDefined();
  });

  it("lockActiveMovieForUpdate holds the lock while it reports archived", async () => {
    const movieId = await seedMovie({ archived: true });

    await inRuntimeTx(async (tx) => {
      expect(await locks.lockActiveMovieForUpdate(tx, movieId)).toEqual({ ok: false, error: { kind: "archived" } });
      await expectRowLockedAgainst(movieId, "FOR SHARE");
    });
  });

  it("lockActiveMovieShared holds FOR SHARE: it blocks updates but not other shared locks", async () => {
    const movieId = await seedMovie({ archived: true });

    await inRuntimeTx(async (tx) => {
      expect(await locks.lockActiveMovieShared(tx, movieId)).toEqual({ ok: false, error: { kind: "archived" } });
      await expectRowLockedAgainst(movieId, "FOR UPDATE");
      await expect(
        observer.query("SELECT 1 FROM app.movie WHERE id = $1 FOR SHARE NOWAIT", [movieId]),
      ).resolves.toBeDefined();
    });
  });

  it("lockMovieForUpdate holds FOR UPDATE on an archived Movie", async () => {
    const movieId = await seedMovie({ archived: true });

    await inRuntimeTx(async (tx) => {
      await locks.lockMovieForUpdate(tx, movieId);
      await expectRowLockedAgainst(movieId, "FOR SHARE");
    });
  });
});

describe("Catalogue core — PostgreSQL transactions", () => {
  beforeEach(async () => {
    await owner.query("TRUNCATE app.movie CASCADE");
  });

  it("rolling back leaves the revision and pending time unchanged", async () => {
    const movieId = await seedMovie({ reviewsRevision: 5 });
    const before = await stored(movieId);
    const failure = new Error("synthetic review write failure");

    await expect(
      inRuntimeTx(async (tx) => {
        const locked = await locks.lockActiveMovieForUpdate(tx, movieId);
        if (!locked.ok) {
          throw new Error("expected an active Movie");
        }
        expect(await marker.markReviewsChanged(tx, locked.value)).toBe(6);
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await stored(movieId)).toEqual(before);
  });

  it("a stale recordSummaryPublished leaves an earlier write in the same Tx committed", async () => {
    const movieId = await seedMovie({ reviewsRevision: 3 });

    const result = await inRuntimeTx(async (tx) => {
      const locked = await locks.lockActiveMovieForUpdate(tx, movieId);
      if (!locked.ok) {
        throw new Error("expected an active Movie");
      }
      await marker.markReviewsChanged(tx, locked.value);
      return schedule.recordSummaryPublished(tx, locked.value, locked.value.reviewsRevision);
    });

    expect(result).toEqual({ ok: false, error: { kind: "stale" } });
    expect(await stored(movieId)).toMatchObject({ reviewsRevision: 4, summaryLastSuccessAt: null });
  });

  it("serializes two markers on the same Movie, so each sees the other's revision", async () => {
    const movieId = await seedMovie();
    const second = createDatabase({ url: testDatabaseUrl(), caCert: null });
    const secondLocks = createMovieLocks({ sql: second });
    const secondMarker = createReviewsChangedMarker({ sql: second });

    const markOn = (database: Database, movieLocks: MovieLocks, changedMarker: ReviewsChangedMarker) =>
      database.withTransaction(async (tx) => {
        const locked = await movieLocks.lockActiveMovieForUpdate(tx, movieId);
        if (!locked.ok) {
          throw new Error("expected an active Movie");
        }
        return changedMarker.markReviewsChanged(tx, locked.value);
      });

    const revisions = await Promise.all([
      markOn(db, locks, marker),
      markOn(second, secondLocks, secondMarker),
      markOn(db, locks, marker),
      markOn(second, secondLocks, secondMarker),
    ]);

    expect([...revisions].sort()).toEqual([1, 2, 3, 4]);
    expect((await stored(movieId)).reviewsRevision).toBe(4);
  });
});
