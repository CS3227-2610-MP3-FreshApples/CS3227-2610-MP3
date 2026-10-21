import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import { createReviewRepository } from "../../../src/server/repositories/reviews";
import { createMovieLocks, createReviewsChangedMarker } from "../../../src/server/services/catalogue";
import { createReviewLocksAndReads, createReviewTransitions } from "../../../src/server/services/reviews";
import type { MovieId, ReviewId, RowVersion, Tx } from "../../../src/server/shared";
import { connectAsOwner, insertAccount, insertMovie, insertReview } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";

const db: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const movieLocks = createMovieLocks({ sql: db });
const marker = createReviewsChangedMarker({ sql: db });
const reviews = createReviewRepository({ sql: db });
const locks = createReviewLocksAndReads({ reviews, movieLocks });
const transitions = createReviewTransitions({ reviews, reviewsChangedMarker: marker });

let owner: Client;

beforeAll(async () => {
  owner = await connectAsOwner();
});

afterAll(async () => {
  await owner.end();
});

beforeEach(async () => {
  await owner.query("TRUNCATE app.movie CASCADE");
});

async function inRuntimeTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.withTransaction(async (tx) => {
    await db.query(tx, "SET LOCAL ROLE app_runtime", []);
    return work(tx);
  });
}

async function seedReview(): Promise<{ movieId: MovieId; reviewId: string }> {
  const movieId = (await insertMovie(owner)) as MovieId;
  const authorId = await insertAccount(owner);
  const reviewId = await insertReview(owner, movieId, authorId);
  return { movieId, reviewId };
}

describe("K8 PostgreSQL transition repository and transaction boundaries", () => {
  it("applies guarded automatic clearance and records AI provenance", async () => {
    const { reviewId } = await seedReview();
    const applied = await inRuntimeTx(async (tx) => {
      const locked = await locks.lockReviewForTransition(tx, reviewId as ReviewId);
      if (!locked.ok) throw new Error("expected Review lock");
      return reviews.applyAutomatic(tx, locked.value, "cleared");
    });

    expect(applied).toMatchObject({ moderation_state: "cleared", version: 2 });
    const { rows } = await owner.query("SELECT moderation_state, clearance_source, version FROM app.review WHERE id = $1", [reviewId]);
    expect(rows[0]).toEqual({ moderation_state: "cleared", clearance_source: "ai", version: 2 });

    const stale = await inRuntimeTx(async (tx) => {
      const locked = await locks.lockReviewForTransition(tx, reviewId as ReviewId);
      if (!locked.ok) throw new Error("expected Review lock");
      return reviews.applyAutomatic(tx, { ...locked.value, version: 1 as RowVersion }, "flagged");
    });
    expect(stale).toBeNull();
  });

  it("applies Admin approve, hide, and restore with guarded version increments", async () => {
    const { reviewId } = await seedReview();
    const approve = await inRuntimeTx(async (tx) => {
      const locked = await locks.lockReviewForTransition(tx, reviewId as ReviewId);
      if (!locked.ok) throw new Error("expected Review lock");
      return transitions.approveHeldReview(tx, locked.value, locked.value.version);
    });
    expect(approve).toMatchObject({ ok: true, value: { moderationState: "cleared", version: 2, eligibilityChanged: true } });

    const hide = await inRuntimeTx(async (tx) => {
      const locked = await locks.lockReviewForTransition(tx, reviewId as ReviewId);
      if (!locked.ok) throw new Error("expected Review lock");
      return transitions.hideReview(tx, locked.value, locked.value.version);
    });
    expect(hide).toMatchObject({ ok: true, value: { hidden: true, version: 3, eligibilityChanged: true } });

    const restore = await inRuntimeTx(async (tx) => {
      const locked = await locks.lockReviewForTransition(tx, reviewId as ReviewId);
      if (!locked.ok) throw new Error("expected Review lock");
      return transitions.restoreHiddenReview(tx, locked.value, locked.value.version);
    });
    expect(restore).toMatchObject({ ok: true, value: { hidden: false, version: 4, eligibilityChanged: true } });

    const { rows } = await owner.query("SELECT moderation_state, clearance_source, hidden_at, version FROM app.review WHERE id = $1", [reviewId]);
    expect(rows[0]).toMatchObject({ moderation_state: "cleared", clearance_source: "admin", hidden_at: null, version: 4 });
  });

  it("rolls back a transition when K7 invalidation fails", async () => {
    const { reviewId } = await seedReview();
    const failingTransitions = createReviewTransitions({
      reviews,
      reviewsChangedMarker: {
        async markReviewsChanged() {
          throw new Error("synthetic marker failure");
        },
      },
    });

    await expect(
      db.withTransaction(async (tx) => {
        await db.query(tx, "SET LOCAL ROLE app_runtime", []);
        const locked = await locks.lockReviewForTransition(tx, reviewId as ReviewId);
        if (!locked.ok) throw new Error("expected Review lock");
        await failingTransitions.applyAutomaticClearance(tx, locked.value, {
          contentRevision: locked.value.contentRevision,
          version: locked.value.version,
        });
      }),
    ).rejects.toThrow("synthetic marker failure");

    const { rows } = await owner.query("SELECT moderation_state, clearance_source, version FROM app.review WHERE id = $1", [reviewId]);
    expect(rows[0]).toEqual({ moderation_state: "pending", clearance_source: null, version: 1 });
  });
});
