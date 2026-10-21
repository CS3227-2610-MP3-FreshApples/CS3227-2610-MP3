import type { Client } from "pg";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import { createReportRepository } from "../../../src/server/repositories/moderation";
import type { AccountId, MovieId, ReviewId, Tx } from "../../../src/server/shared";
import { parseEvidenceSnapshot } from "../../../src/server/services/moderation";
import { connectAsOwner, insertAccount, insertMovie, insertReview } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";

const db: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const reports = createReportRepository({ sql: db });
let owner: Client;

async function asRuntime(tx: Tx): Promise<void> {
  await db.query(tx, "SET LOCAL ROLE app_runtime", []);
}

describe("Report repository — PostgreSQL", () => {
  beforeAll(async () => {
    owner = await connectAsOwner();
  });

  afterAll(async () => {
    await owner.end();
  });

  it("reads the locked target and stores the K11 snapshot as JSON", async () => {
    const reporterId = (await insertAccount(owner)) as AccountId;
    const authorId = (await insertAccount(owner)) as AccountId;
    const movieId = (await insertMovie(owner)) as MovieId;
    const reviewId = (await insertReview(owner, movieId, authorId)) as ReviewId;
    await owner.query("UPDATE app.review SET moderation_state = 'cleared', version = 3 WHERE id = $1", [reviewId]);

    const result = await db.withTransaction(async (tx) => {
      await asRuntime(tx);
      const initial = await reports.findForReport(tx, reviewId);
      const locked = await reports.lockForReport(tx, movieId, reviewId);
      const saved = await reports.insert(tx, {
        reporterId,
        targetUserId: authorId,
        reviewId,
        category: "harassment",
        explanation: "A valid report explanation.",
        evidenceSnapshot: {
          reviewId,
          reviewVersion: locked!.reviewVersion,
          authorId,
          movieId,
          movieTitle: locked!.movieTitle,
          body: locked!.body,
          rating: locked!.rating,
        },
      });
      return { initial, locked, saved };
    });

    expect(result.initial).toMatchObject({ reviewId, movieId, authorId, moderationState: "cleared", movieArchived: false });
    expect(result.locked).toMatchObject({ reviewId, reviewVersion: 3 });
    expect(result.saved).toMatchObject({ reporterId, reviewId, category: "harassment", status: "open" });
    const stored = await owner.query<{ evidence_snapshot: unknown }>("SELECT evidence_snapshot FROM app.report WHERE id = $1", [result.saved.id]);
    expect(parseEvidenceSnapshot(stored.rows[0]?.evidence_snapshot)).toMatchObject({ ok: true, value: { reviewVersion: 3, authorId, movieId } });
  });
});
