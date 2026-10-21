import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createReviewLocksAndReads } from "../../../src/server/services/reviews";
import type { ReviewRecord, ReviewTransitionRow, ReviewScreeningRow } from "../../../src/server/repositories/reviews";
import type { ContentRevision, MovieId, ReviewId, ReviewUpdateLock, RowVersion, Tx } from "../../../src/server/shared";

const MOVIE_ID = "00000000-0000-4000-8000-000000000002" as MovieId;
const REVIEW_ID = "00000000-0000-4000-8000-000000000001" as ReviewId;
const TX = {} as Tx;
const MOVIE = { movieId: MOVIE_ID, archived: false, reviewsRevision: 4 } as ReviewUpdateLock["movie"];

function review(): ReviewRecord {
  return {
    id: REVIEW_ID,
    movieId: MOVIE_ID,
    authorId: "00000000-0000-4000-8000-000000000003" as ReviewRecord["authorId"],
    authorDisplayName: "Reviewer",
    rating: 8,
    body: "A sufficiently long review body.",
    deletedAt: null,
    hiddenAt: null,
    moderationState: "pending",
    contentRevision: 2 as ContentRevision,
    clearanceSource: null,
    version: 3 as RowVersion,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("K8 lock/read boundary", () => {
  it("locks Movie before Review and returns the typed ReviewUpdateLock", async () => {
    const calls: string[] = [];
    const saved = review();
    const transitions = createReviewLocksAndReads({
      movieLocks: {
        async lockMovieForUpdate(_tx, movieId) {
          calls.push(`movie:${movieId}`);
          return { ok: true, value: MOVIE };
        },
      },
      reviews: {
        async findById() {
          calls.push("read");
          return saved;
        },
        async lockForTransition(_tx, reviewId, movie) {
          calls.push(`review:${reviewId}:${movie.movieId}`);
          return {
            id: REVIEW_ID,
            version: saved.version,
            content_revision: saved.contentRevision,
            moderation_state: saved.moderationState,
            hidden_at: saved.hiddenAt,
            deleted_at: saved.deletedAt,
          } satisfies ReviewTransitionRow;
        },
        async lockAllForMovie(_tx, movie) {
          calls.push(`all:${movie.movieId}`);
        },
        async readForScreening() {
          return null;
        },
      },
    });

    await expect(transitions.lockReviewForTransition(TX, REVIEW_ID)).resolves.toMatchObject({
      ok: true,
      value: {
        reviewId: REVIEW_ID,
        movie: MOVIE,
        version: 3,
        contentRevision: 2,
        moderationState: "pending",
        hidden: false,
        deleted: false,
      },
    });
    await transitions.lockReviewsOfMovie(TX, MOVIE);
    expect(calls).toEqual(["read", `movie:${MOVIE_ID}`, `review:${REVIEW_ID}:${MOVIE_ID}`, `all:${MOVIE_ID}`]);
  });

  it("projects the screening read without exposing unrelated Review fields", async () => {
    const source: ReviewScreeningRow = {
      id: REVIEW_ID,
      content_revision: 2 as ContentRevision,
      version: 3 as RowVersion,
      body: "A sufficiently long review body.",
      moderation_state: "pending",
      hidden_at: null,
      deleted_at: null,
      movie_archived: true,
    };
    const transitions = createReviewLocksAndReads({
      movieLocks: { lockMovieForUpdate: async () => ({ ok: false, error: { kind: "not_found" } }) },
      reviews: {
        findById: async () => null,
        lockForTransition: async () => null,
        lockAllForMovie: async () => undefined,
        readForScreening: async () => source,
      },
    });

    await expect(transitions.readReviewForScreening(TX, REVIEW_ID)).resolves.toEqual({
      ok: true,
      value: {
        reviewId: REVIEW_ID,
        contentRevision: 2,
        version: 3,
        body: source.body,
        moderationState: "pending",
        hidden: false,
        deleted: false,
        movieArchived: true,
      },
    });
  });
});
