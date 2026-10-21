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
  it("returns the Review state re-read after post-commit dispatch", async () => {
    let dispatched = false;
    const clearedReview = {
      ...REVIEW,
      moderationState: "cleared" as const,
      clearanceSource: "ai" as const,
      version: 2 as ReviewRecord["version"],
    };
    const dispatcher = vi.fn(async () => {
      dispatched = true;
      return "cleared" as const;
    });
    const service = createReviewService(dependencies({
      reviews: {
        ...dependencies().reviews,
        findById: async () => dispatched ? clearedReview : null,
      },
      moderationDispatcher: { attemptAfterCommit: dispatcher },
    }));

    const result = await service.create(REVIEW.movieId, REVIEW.authorId, { rating: 8, body: REVIEW.body });

    expect(result).toEqual({ ok: true, value: clearedReview });
    expect(dispatcher).toHaveBeenCalledWith(REVIEW.id, REVIEW.contentRevision);
  });

  it("enqueues moderation work before advancing the public review revision", async () => {
    const events: string[] = [];
    const eligibleReview = {
      ...REVIEW,
      moderationState: "cleared" as const,
      clearanceSource: "ai" as const,
    };
    const updatedReview = {
      ...eligibleReview,
      body: "Updated review body.",
      moderationState: "pending" as const,
      clearanceSource: null,
      contentRevision: 2 as ReviewRecord["contentRevision"],
      version: 2 as ReviewRecord["version"],
    };
    const service = createReviewService(dependencies({
      reviews: {
        ...dependencies().reviews,
        findById: async () => eligibleReview,
        findForAuthorWrite: async () => eligibleReview,
        updateBody: async () => updatedReview,
      },
      reviewsChangedMarker: { markReviewsChanged: async () => { events.push("marker"); return 1; } },
      moderationWorkQueue: {
        enqueue: async () => { events.push("enqueue"); },
        cancelForDeletedReview: async () => undefined,
      },
    }));

    await service.edit(REVIEW.id, REVIEW.authorId, REVIEW.version, { body: updatedReview.body });

    expect(events).toEqual(["enqueue", "marker"]);
  });

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

  it("does not enqueue moderation work for a rating-only edit", async () => {
    const enqueue = vi.fn();
    const dispatcher = vi.fn();
    const service = createReviewService(dependencies({
      reviews: {
        ...dependencies().reviews,
        findById: async () => REVIEW,
        findForAuthorWrite: async () => REVIEW,
        updateRatingOnly: async () => ({ ...REVIEW, rating: 9, version: 2 as ReviewRecord["version"] }),
      },
      moderationWorkQueue: { enqueue, cancelForDeletedReview: async () => undefined },
      moderationDispatcher: { attemptAfterCommit: dispatcher },
    }));

    const result = await service.edit(REVIEW.id, REVIEW.authorId, REVIEW.version, { rating: 9 });

    expect(result.ok).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("does not dispatch when a rating edit repeats the existing body", async () => {
    const enqueue = vi.fn();
    const dispatcher = vi.fn();
    const service = createReviewService(dependencies({
      reviews: {
        ...dependencies().reviews,
        findById: async () => REVIEW,
        findForAuthorWrite: async () => REVIEW,
        updateRatingOnly: async () => ({ ...REVIEW, rating: 9, version: 2 as ReviewRecord["version"] }),
      },
      moderationWorkQueue: { enqueue, cancelForDeletedReview: async () => undefined },
      moderationDispatcher: { attemptAfterCommit: dispatcher },
    }));

    const result = await service.edit(REVIEW.id, REVIEW.authorId, REVIEW.version, { rating: 9, body: REVIEW.body });

    expect(result.ok).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("dispatches a changed body edit with its new content revision", async () => {
    const dispatcher = vi.fn().mockResolvedValue("deferred" as const);
    const updatedReview = {
      ...REVIEW,
      body: "Updated review body.",
      contentRevision: 2 as ReviewRecord["contentRevision"],
      version: 2 as ReviewRecord["version"],
    };
    const service = createReviewService(dependencies({
      reviews: {
        ...dependencies().reviews,
        findById: async () => REVIEW,
        findForAuthorWrite: async () => REVIEW,
        updateBody: async () => updatedReview,
      },
      moderationDispatcher: { attemptAfterCommit: dispatcher },
    }));

    const result = await service.edit(REVIEW.id, REVIEW.authorId, REVIEW.version, { body: updatedReview.body });

    expect(result.ok).toBe(true);
    expect(dispatcher).toHaveBeenCalledWith(REVIEW.id, updatedReview.contentRevision);
  });

  it("does not mark the Movie changed or dispatch when body moderation enqueue fails", async () => {
    const marker = vi.fn();
    const dispatcher = vi.fn();
    const service = createReviewService(dependencies({
      database: {
        withTransactionResult: async (callback) => {
          try { return await callback({} as never); } catch { return { ok: false, error: { kind: "conflict" } } as never; }
        },
      },
      reviews: {
        ...dependencies().reviews,
        findById: async () => REVIEW,
        findForAuthorWrite: async () => REVIEW,
        updateBody: async () => ({ ...REVIEW, body: "Updated review body.", contentRevision: 2 as ReviewRecord["contentRevision"], version: 2 as ReviewRecord["version"] }),
      },
      reviewsChangedMarker: { markReviewsChanged: marker },
      moderationWorkQueue: { enqueue: async () => { throw new Error("queue unavailable"); }, cancelForDeletedReview: async () => undefined },
      moderationDispatcher: { attemptAfterCommit: dispatcher },
    }));

    const result = await service.edit(REVIEW.id, REVIEW.authorId, REVIEW.version, { body: "Updated review body." });

    expect(result).toEqual({ ok: false, error: { kind: "conflict" } });
    expect(marker).not.toHaveBeenCalled();
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("cancels outstanding moderation work when a review is deleted", async () => {
    const cancel = vi.fn();
    const dispatcher = vi.fn();
    const deletedReview = { ...REVIEW, deletedAt: new Date(), version: 2 as ReviewRecord["version"] };
    const service = createReviewService(dependencies({
      reviews: {
        ...dependencies().reviews,
        findById: async () => REVIEW,
        findForAuthorWrite: async () => REVIEW,
        softDelete: async () => deletedReview,
      },
      moderationWorkQueue: { enqueue: async () => undefined, cancelForDeletedReview: cancel },
      moderationDispatcher: { attemptAfterCommit: dispatcher },
    }));

    const result = await service.delete(REVIEW.id, REVIEW.authorId, REVIEW.version);

    expect(result).toEqual({ ok: true, value: deletedReview });
    expect(cancel).toHaveBeenCalledWith(expect.anything(), REVIEW.id);
    expect(dispatcher).not.toHaveBeenCalled();
  });
});
