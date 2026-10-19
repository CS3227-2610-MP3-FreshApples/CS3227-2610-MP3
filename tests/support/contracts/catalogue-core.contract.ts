import { beforeEach, describe, expect, it } from "vitest";

import type { MovieLocks, ReviewsChangedMarker, SummarySchedule } from "../../../src/server/services/catalogue";
import type { MovieId, MovieUpdateLock, ReviewsRevision, Tx } from "../../../src/server/shared";

/** The Movie columns K7 reads or writes, as stored by the implementation under test. */
export interface StoredMovie {
  readonly archived: boolean;
  readonly reviewsRevision: number;
  readonly version: number;
  readonly summaryPendingSince: Date | null;
  readonly summaryNextAttemptAt: Date | null;
  readonly summaryLastAttemptAt: Date | null;
  readonly summaryLastSuccessAt: Date | null;
  readonly updatedAt: Date;
}

export interface MovieSeed {
  readonly archived?: boolean;
  readonly reviewsRevision?: number;
  readonly summaryPendingSince?: Date | null;
  readonly summaryNextAttemptAt?: Date | null;
  readonly summaryLastAttemptAt?: Date | null;
}

export interface CatalogueCoreHarness {
  readonly locks: MovieLocks;
  readonly marker: ReviewsChangedMarker;
  readonly schedule: SummarySchedule;
  /** Stores a Movie with `updated_at` in the past, so any write is visible as a change. */
  seedMovie(seed?: MovieSeed): Promise<MovieId>;
  /** An id no stored Movie has. */
  missingMovieId(): MovieId;
  /** Runs `work` in a transaction that commits when it resolves. */
  inTx<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  stored(movieId: MovieId): Promise<StoredMovie>;
}

// Synthetic times, well before any test run.
const PENDING_SINCE = new Date("2026-01-02T03:04:05.000Z");
const NEXT_ATTEMPT_AT = new Date("2026-01-03T00:00:00.000Z");
const LAST_ATTEMPT_AT = new Date("2026-01-02T12:00:00.000Z");
const NEW_NEXT_ATTEMPT_AT = new Date("2026-02-01T00:00:00.000Z");

/**
 * K7 contract suite (workflow/contracts.md §10, §22 AM-13; D-51). Runs against the in-memory fake, with
 * seeded Movies, and the PostgreSQL implementation. Rollback and lock-wait behaviour need PostgreSQL and
 * are tested only there.
 */
export function describeCatalogueCoreContract(label: string, setup: () => Promise<CatalogueCoreHarness>): void {
  describe(`Catalogue core (K7) contract — ${label}`, () => {
    let harness: CatalogueCoreHarness;

    beforeEach(async () => {
      harness = await setup();
    });

    /** Locks a seeded Movie in any archive state and runs `work` with the handle in the same Tx (§2.3). */
    function withUpdateLock<T>(movieId: MovieId, work: (tx: Tx, lock: MovieUpdateLock) => Promise<T>): Promise<T> {
      return harness.inTx(async (tx) => {
        const locked = await harness.locks.lockMovieForUpdate(tx, movieId);
        if (!locked.ok) {
          throw new Error("expected the seeded Movie to lock");
        }
        return work(tx, locked.value);
      });
    }

    const lockUpdate = (movieId: MovieId) => withUpdateLock(movieId, async (_tx, lock) => lock);
    const mark = (movieId: MovieId) =>
      withUpdateLock(movieId, (tx, lock) => harness.marker.markReviewsChanged(tx, lock));
    const publish = (movieId: MovieId, published: number) =>
      withUpdateLock(movieId, (tx, lock) =>
        harness.schedule.recordSummaryPublished(tx, lock, published as ReviewsRevision),
      );

    describe("lock functions", () => {
      it("return not_found for a missing Movie", async () => {
        const missing = harness.missingMovieId();
        await harness.inTx(async (tx) => {
          expect(await harness.locks.lockActiveMovieForUpdate(tx, missing)).toEqual({
            ok: false,
            error: { kind: "not_found" },
          });
          expect(await harness.locks.lockActiveMovieShared(tx, missing)).toEqual({
            ok: false,
            error: { kind: "not_found" },
          });
          expect(await harness.locks.lockMovieForUpdate(tx, missing)).toEqual({
            ok: false,
            error: { kind: "not_found" },
          });
        });
      });

      it("lockActiveMovieForUpdate returns a handle with the stored revision for an active Movie", async () => {
        const movieId = await harness.seedMovie({ reviewsRevision: 4 });

        const locked = await harness.inTx((tx) => harness.locks.lockActiveMovieForUpdate(tx, movieId));

        expect(locked).toEqual({ ok: true, value: { movieId, archived: false, reviewsRevision: 4 } });
      });

      it("lockActiveMovieShared returns a handle for an active Movie", async () => {
        const movieId = await harness.seedMovie();

        const locked = await harness.inTx((tx) => harness.locks.lockActiveMovieShared(tx, movieId));

        expect(locked).toEqual({ ok: true, value: { movieId } });
      });

      it("lockActiveMovieForUpdate and lockActiveMovieShared return archived for an archived Movie", async () => {
        const movieId = await harness.seedMovie({ archived: true });

        await harness.inTx(async (tx) => {
          expect(await harness.locks.lockActiveMovieForUpdate(tx, movieId)).toEqual({
            ok: false,
            error: { kind: "archived" },
          });
          expect(await harness.locks.lockActiveMovieShared(tx, movieId)).toEqual({
            ok: false,
            error: { kind: "archived" },
          });
        });
      });

      it("lockMovieForUpdate locks a Movie in any archive state", async () => {
        const active = await harness.seedMovie({ reviewsRevision: 2 });
        const archived = await harness.seedMovie({ archived: true, reviewsRevision: 7 });

        expect(await lockUpdate(active)).toEqual({ movieId: active, archived: false, reviewsRevision: 2 });
        expect(await lockUpdate(archived)).toEqual({ movieId: archived, archived: true, reviewsRevision: 7 });
      });

      it("write nothing", async () => {
        const movieId = await harness.seedMovie({ summaryPendingSince: PENDING_SINCE });
        const before = await harness.stored(movieId);

        await harness.inTx(async (tx) => {
          await harness.locks.lockActiveMovieForUpdate(tx, movieId);
          await harness.locks.lockActiveMovieShared(tx, movieId);
          await harness.locks.lockMovieForUpdate(tx, movieId);
        });

        expect(await harness.stored(movieId)).toEqual(before);
      });
    });

    describe("markReviewsChanged (D-51)", () => {
      it("advances reviews_revision by one and returns the new revision", async () => {
        const movieId = await harness.seedMovie({ reviewsRevision: 3 });

        expect(await mark(movieId)).toBe(4);
        expect((await harness.stored(movieId)).reviewsRevision).toBe(4);
      });

      it("sets summary_pending_since and updated_at when nothing is pending", async () => {
        const movieId = await harness.seedMovie();
        const before = await harness.stored(movieId);

        await mark(movieId);

        const after = await harness.stored(movieId);
        expect(before.summaryPendingSince).toBeNull();
        expect(after.summaryPendingSince).toBeInstanceOf(Date);
        expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      });

      it("preserves an existing summary_pending_since on a second call", async () => {
        const movieId = await harness.seedMovie();

        await mark(movieId);
        const first = (await harness.stored(movieId)).summaryPendingSince;
        await mark(movieId);

        const after = await harness.stored(movieId);
        expect(first).toBeInstanceOf(Date);
        expect(after.summaryPendingSince).toEqual(first);
        expect(after.reviewsRevision).toBe(2);
      });

      it("preserves a seeded oldest pending time", async () => {
        const movieId = await harness.seedMovie({ summaryPendingSince: PENDING_SINCE });

        await mark(movieId);

        expect((await harness.stored(movieId)).summaryPendingSince).toEqual(PENDING_SINCE);
      });

      it("leaves Movie.version unchanged", async () => {
        const movieId = await harness.seedMovie();
        const before = await harness.stored(movieId);

        await mark(movieId);

        expect((await harness.stored(movieId)).version).toBe(before.version);
      });

      it("leaves the summary attempt and success columns unchanged", async () => {
        const movieId = await harness.seedMovie({
          summaryNextAttemptAt: NEXT_ATTEMPT_AT,
          summaryLastAttemptAt: LAST_ATTEMPT_AT,
        });

        await mark(movieId);

        expect(await harness.stored(movieId)).toMatchObject({
          summaryNextAttemptAt: NEXT_ATTEMPT_AT,
          summaryLastAttemptAt: LAST_ATTEMPT_AT,
          summaryLastSuccessAt: null,
        });
      });

      it("does not inspect the lock's archived flag", async () => {
        const movieId = await harness.seedMovie({ archived: true, reviewsRevision: 5 });

        expect(await mark(movieId)).toBe(6);
        expect(await harness.stored(movieId)).toMatchObject({ archived: true, reviewsRevision: 6 });
      });
    });

    describe("recordSummaryAttempt (D-51)", () => {
      it("sets the last and next attempt times and updated_at only", async () => {
        const movieId = await harness.seedMovie({ reviewsRevision: 2, summaryPendingSince: PENDING_SINCE });
        const before = await harness.stored(movieId);

        await withUpdateLock(movieId, (tx, lock) =>
          harness.schedule.recordSummaryAttempt(tx, lock, NEW_NEXT_ATTEMPT_AT),
        );

        const after = await harness.stored(movieId);
        expect(after.summaryLastAttemptAt).toBeInstanceOf(Date);
        expect(after.summaryLastAttemptAt!.getTime()).toBeGreaterThan(before.updatedAt.getTime());
        expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
        expect(after).toEqual({
          ...before,
          summaryNextAttemptAt: NEW_NEXT_ATTEMPT_AT,
          summaryLastAttemptAt: after.summaryLastAttemptAt,
          updatedAt: after.updatedAt,
        });
      });
    });

    describe("recordSummaryPublished (D-51)", () => {
      it("clears pending and sets last success for an active Movie at the published revision", async () => {
        const movieId = await harness.seedMovie({
          reviewsRevision: 3,
          summaryPendingSince: PENDING_SINCE,
          summaryNextAttemptAt: NEXT_ATTEMPT_AT,
          summaryLastAttemptAt: LAST_ATTEMPT_AT,
        });
        const before = await harness.stored(movieId);

        const result = await publish(movieId, 3);

        expect(result).toEqual({ ok: true, value: undefined });
        const after = await harness.stored(movieId);
        expect(after.summaryLastSuccessAt).toBeInstanceOf(Date);
        expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
        expect(after).toEqual({
          ...before,
          summaryPendingSince: null,
          summaryLastSuccessAt: after.summaryLastSuccessAt,
          updatedAt: after.updatedAt,
        });
      });

      it("returns stale and writes nothing for an older revision", async () => {
        const movieId = await harness.seedMovie({ reviewsRevision: 3, summaryPendingSince: PENDING_SINCE });
        const before = await harness.stored(movieId);

        const result = await publish(movieId, 2);

        expect(result).toEqual({ ok: false, error: { kind: "stale" } });
        expect(await harness.stored(movieId)).toEqual(before);
      });

      it("returns stale and writes nothing when the revision advanced after the summary was captured", async () => {
        const movieId = await harness.seedMovie({ reviewsRevision: 3 });
        await mark(movieId);
        const before = await harness.stored(movieId);

        expect(await publish(movieId, 3)).toEqual({ ok: false, error: { kind: "stale" } });
        expect(await harness.stored(movieId)).toEqual(before);
      });

      it("returns stale for a revision captured earlier in the same Tx after markReviewsChanged", async () => {
        const movieId = await harness.seedMovie({ reviewsRevision: 3 });

        const result = await withUpdateLock(movieId, async (tx, lock) => {
          await harness.marker.markReviewsChanged(tx, lock);
          return harness.schedule.recordSummaryPublished(tx, lock, lock.reviewsRevision);
        });

        expect(result).toEqual({ ok: false, error: { kind: "stale" } });
        expect((await harness.stored(movieId)).summaryPendingSince).toBeInstanceOf(Date);
      });

      it("returns stale and writes nothing for an archived Movie at the published revision", async () => {
        const movieId = await harness.seedMovie({
          archived: true,
          reviewsRevision: 3,
          summaryPendingSince: PENDING_SINCE,
        });
        const before = await harness.stored(movieId);

        const result = await publish(movieId, 3);

        expect(result).toEqual({ ok: false, error: { kind: "stale" } });
        expect(await harness.stored(movieId)).toEqual(before);
      });
    });
  });
}
