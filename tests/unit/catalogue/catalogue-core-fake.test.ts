import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { MovieId, Tx } from "../../../src/server/shared";
import { describeCatalogueCoreContract } from "../../support/contracts/catalogue-core.contract";
import { createFakeCatalogueCore } from "../../support/fakes/catalogue-core";

// The fake has no transactions; tests that need rollback or lock waits use PostgreSQL (D-10).
const TX = {} as Tx;

function newMovieId(): MovieId {
  return randomUUID() as MovieId;
}

describeCatalogueCoreContract("in-memory fake (seeded Movies)", async () => {
  const fake = createFakeCatalogueCore();
  return {
    locks: fake.locks,
    marker: fake.marker,
    schedule: fake.schedule,
    seedMovie: async (seed) => {
      const movieId = newMovieId();
      fake.seedMovie(movieId, seed);
      return movieId;
    },
    missingMovieId: newMovieId,
    inTx: (work) => work(TX),
    stored: async (movieId) => fake.stored(movieId),
  };
});

describe("fake catalogue core — fails closed", () => {
  it("returns not_found from every lock function for an unseeded Movie", async () => {
    const { locks } = createFakeCatalogueCore();
    const movieId = newMovieId();

    expect(await locks.lockActiveMovieForUpdate(TX, movieId)).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(await locks.lockActiveMovieShared(TX, movieId)).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(await locks.lockMovieForUpdate(TX, movieId)).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("does not lock a Movie seeded on another fake", async () => {
    const seeded = createFakeCatalogueCore();
    const other = createFakeCatalogueCore();
    const movieId = newMovieId();
    seeded.seedMovie(movieId);

    expect(await other.locks.lockActiveMovieForUpdate(TX, movieId)).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });

  it("throws when storing state for an unseeded Movie", () => {
    expect(() => createFakeCatalogueCore().stored(newMovieId())).toThrow("not seeded");
  });
});

describe("fake catalogue core — recording", () => {
  it("records every markReviewsChanged call with its Movie and returned revision, in call order", async () => {
    const fake = createFakeCatalogueCore();
    const first = newMovieId();
    const second = newMovieId();
    fake.seedMovie(first, { reviewsRevision: 2 });
    fake.seedMovie(second, { archived: true });

    for (const movieId of [first, second, first]) {
      const locked = await fake.locks.lockMovieForUpdate(TX, movieId);
      if (!locked.ok) {
        throw new Error("expected a seeded Movie");
      }
      await fake.marker.markReviewsChanged(TX, locked.value);
    }

    expect(fake.markCalls).toEqual([
      { movieId: first, revision: 3 },
      { movieId: second, revision: 1 },
      { movieId: first, revision: 4 },
    ]);
  });
});
