import { describe, expect, it, vi } from "vitest";
import type { ReviewRecord } from "../../../src/server/repositories/reviews";
import { createReviewService, type ReviewServiceDependencies } from "../../../src/server/services/reviews";
import type { AccountId, MovieId, ReviewId } from "../../../src/server/shared";

vi.mock("server-only", () => ({}));

const REVIEW = {
  id: "11111111-1111-4111-8111-111111111111" as ReviewId,
  movieId: "22222222-2222-4222-8222-222222222222" as MovieId,
  authorId: "33333333-3333-4333-8333-333333333333" as AccountId,
  authorDisplayName: "Synthetic",
  rating: 8,
  body: "A valid review body.",
  deletedAt: null,
  hiddenAt: null,
  moderationState: "pending" as const,
  contentRevision: 1 as ReviewRecord["contentRevision"],
  clearanceSource: null,
  version: 1 as ReviewRecord["version"],
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies ReviewRecord;

function dependencies(overrides: Partial<ReviewServiceDependencies> = {}): ReviewServiceDependencies {
  return {
    database: { withTransactionResult: async (callback) => callback({} as never) },
    accounts: { lockActiveUserShared: async () => ({ accountId: REVIEW.authorId }) },
    reviews: {
      findById: async () => null,
      findForWrite: async () => null,
      findForAuthorWrite: async () => REVIEW,
      insert: async () => REVIEW,
      restoreDeleted: async () => REVIEW,
      updateRatingOnly: async () => REVIEW,
      updateBody: async () => REVIEW,
      softDelete: async () => REVIEW,
    },
    movieLocks: { lockActiveMovieForUpdate: async () => ({ ok: true, value: { movieId: REVIEW.movieId, archived: false, reviewsRevision: 0 } }) },
    reviewsChangedMarker: { markReviewsChanged: async () => 1 },
    moderationWorkQueue: { enqueue: async () => undefined, cancelForDeletedReview: async () => undefined },
    moderationDispatcher: { attemptAfterCommit: async () => "deferred" as const },
    rateLimiter: { consume: async () => ({ allowed: true }), check: async () => ({ allowed: true }), purgeExpired: async () => 0 },
    rateLimitKeys: { forAccount: () => "review_mutation:account:test" as never, forEmail: () => "email" as never, forClientIp: () => "ip" as never, forEnvironment: () => "env" as never },
    ...overrides,
  } as ReviewServiceDependencies;
}

describe("Review write transaction boundaries", () => {
  it("keeps the saved Review when post-commit dispatch fails", async () => {
    const dispatcher = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const service = createReviewService(dependencies({ moderationDispatcher: { attemptAfterCommit: dispatcher } }));
    const result = await service.create(REVIEW.movieId, REVIEW.authorId, { rating: 8, body: REVIEW.body });
    expect(result).toEqual({ ok: true, value: REVIEW });
    expect(dispatcher).toHaveBeenCalledWith(REVIEW.id, REVIEW.contentRevision);
  });

  it("does not dispatch when the transactional moderation enqueue fails", async () => {
    const dispatcher = vi.fn();
    const service = createReviewService(dependencies({
      database: { withTransactionResult: async (callback) => {
        try { return await callback({} as never); } catch { return { ok: false, error: { kind: "conflict" } } as never; }
      } },
      moderationWorkQueue: { enqueue: async () => { throw new Error("queue unavailable"); }, cancelForDeletedReview: async () => undefined },
      moderationDispatcher: { attemptAfterCommit: dispatcher },
    }));
    const result = await service.create(REVIEW.movieId, REVIEW.authorId, { rating: 8, body: REVIEW.body });
    expect(result).toEqual({ ok: false, error: { kind: "conflict" } });
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("does not dispatch or advance the version for a no-op body edit", async () => {
    const dispatcher = vi.fn();
    const service = createReviewService(dependencies({
      reviews: {
        ...dependencies().reviews,
        findById: async () => REVIEW,
      },
      moderationDispatcher: { attemptAfterCommit: dispatcher },
    }));
    const result = await service.edit(REVIEW.id, REVIEW.authorId, REVIEW.version, { body: REVIEW.body });
    expect(result).toEqual({ ok: true, value: REVIEW });
    expect(dispatcher).not.toHaveBeenCalled();
  });
});
