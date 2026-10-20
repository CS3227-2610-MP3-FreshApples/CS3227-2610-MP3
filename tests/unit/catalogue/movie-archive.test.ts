import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AdminMovieRecord } from "../../../src/server/repositories/catalogue";
import { createMovieArchiveService, type MovieArchiveDependencies } from "../../../src/server/services/catalogue-archive";
import { movieUpdateLock } from "../../../src/server/services/catalogue/handles";
import type { AccountId, MovieId, RequestId, ReviewsRevision, RowVersion, Tx } from "../../../src/server/shared";
import { createInMemoryAuditLog } from "../../support/fakes/audit-log";

// Isolated orchestration tests (P-12): the call order inside one transaction. PostgreSQL behaviour, rollback
// and locks are covered by tests/integration/api/admin/admin-movies.test.ts.

const TX = {} as Tx;
const ACTOR = { actorId: randomUUID() as AccountId, requestId: randomUUID() as RequestId };

function record(movieId: MovieId, archived: boolean, version: number): AdminMovieRecord {
  return {
    id: movieId,
    title: "Synthetic",
    synopsis: "Synthetic.",
    releaseDate: null,
    genres: [],
    director: "",
    cast: [],
    runtimeMinutes: null,
    archivedAt: archived ? new Date("2026-01-01T00:00:00Z") : null,
    version,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function harness(initial: { archived: boolean; version: number } | null) {
  const movieId = randomUUID() as MovieId;
  const calls: string[] = [];
  const audit = createInMemoryAuditLog();
  let current = initial === null ? null : record(movieId, initial.archived, initial.version);
  let committed: boolean | null = null;
  const deps: MovieArchiveDependencies = {
    database: {
      async withTransactionResult(work) {
        const result = await work(TX);
        committed = result.ok;
        return result;
      },
    },
    movieLocks: {
      async lockMovieForUpdate(_tx, id) {
        calls.push("lockMovie");
        return current === null
          ? { ok: false, error: { kind: "not_found" } }
          : { ok: true, value: movieUpdateLock(id, current.archivedAt !== null, 4) };
      },
    },
    movies: {
      async findById() {
        calls.push("readMovie");
        return current;
      },
      async archive() {
        calls.push("writeArchive");
        current = { ...current!, archivedAt: new Date(), version: current!.version + 1 };
        return current;
      },
      async restore() {
        calls.push("writeRestore");
        current = { ...current!, archivedAt: null, version: current!.version + 1 };
        return current;
      },
    },
    reviewLocks: {
      async lockReviewsOfMovie(_tx, movie) {
        expect(movie.movieId).toBe(movieId);
        calls.push("lockReviews");
      },
    },
    marker: {
      async markReviewsChanged() {
        calls.push("markReviewsChanged");
        return 5 as ReviewsRevision;
      },
    },
    auditLog: {
      async record(tx, entry) {
        calls.push(`audit:${entry.action}:${entry.result}`);
        await audit.record(tx, entry);
      },
    },
  };
  return { movieId, calls, audit, deps, committed: () => committed };
}

describe("movie archive/restore orchestrator (contracts §3.3, D-79, P-12)", () => {
  it("archives in the contract order: Movie lock, Reviews lock, write, marker, audit", async () => {
    const h = harness({ archived: false, version: 3 });

    const result = await createMovieArchiveService(h.deps).archive(h.movieId, 3 as RowVersion, ACTOR);

    expect(result).toEqual({ ok: true, value: 4 });
    expect(h.calls).toEqual(["lockMovie", "readMovie", "lockReviews", "writeArchive", "markReviewsChanged", "audit:movie.archive:applied"]);
    expect(h.audit.entries[0]).toMatchObject({
      actorId: ACTOR.actorId,
      requestId: ACTOR.requestId,
      targetType: "movie",
      targetId: h.movieId,
      metadata: { previousVersion: 3, newVersion: 4, archivedBefore: false, archivedAfter: true },
    });
    expect(h.committed()).toBe(true);
  });

  it("restores in the same order and returns the Admin Movie", async () => {
    const h = harness({ archived: true, version: 2 });

    const result = await createMovieArchiveService(h.deps).restore(h.movieId, 2 as RowVersion, ACTOR);

    expect(result).toMatchObject({ ok: true, value: { id: h.movieId, archivedAt: null, version: 3 } });
    expect(h.calls).toEqual(["lockMovie", "readMovie", "lockReviews", "writeRestore", "markReviewsChanged", "audit:movie.restore:applied"]);
  });

  it("records a no_op without locking Reviews, writing or marking when the state already holds", async () => {
    const archived = harness({ archived: true, version: 2 });
    const active = harness({ archived: false, version: 1 });

    expect(await createMovieArchiveService(archived.deps).archive(archived.movieId, 2 as RowVersion, ACTOR)).toEqual({ ok: true, value: 2 });
    expect(await createMovieArchiveService(active.deps).restore(active.movieId, 1 as RowVersion, ACTOR))
      .toMatchObject({ ok: true, value: { version: 1, archivedAt: null } });

    expect(archived.calls).toEqual(["lockMovie", "readMovie", "audit:movie.archive:no_op"]);
    expect(active.calls).toEqual(["lockMovie", "readMovie", "audit:movie.restore:no_op"]);
    expect(archived.audit.entries[0]!.metadata).toEqual({ previousVersion: 2, newVersion: 2, archivedBefore: true, archivedAfter: true });
    expect(archived.committed()).toBe(true);
  });

  it("checks If-Match before deciding no-op, returning stale_version with no audit and a rollback", async () => {
    const h = harness({ archived: true, version: 2 });

    const result = await createMovieArchiveService(h.deps).archive(h.movieId, 1 as RowVersion, ACTOR);

    expect(result).toEqual({ ok: false, error: { kind: "stale_version" } });
    expect(h.calls).toEqual(["lockMovie", "readMovie"]);
    expect(h.audit.entries).toEqual([]);
    expect(h.committed()).toBe(false);
  });

  it("returns not_found for an unknown Movie without further calls", async () => {
    const h = harness(null);

    expect(await createMovieArchiveService(h.deps).restore(h.movieId, 1 as RowVersion, ACTOR))
      .toEqual({ ok: false, error: { kind: "not_found" } });
    expect(h.calls).toEqual(["lockMovie"]);
  });
});
