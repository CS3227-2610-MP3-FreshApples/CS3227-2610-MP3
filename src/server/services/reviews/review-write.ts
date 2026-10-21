import "server-only";

import type { Database } from "../../db";
import type { AccountRepository } from "../../repositories/identity";
import type { ReviewRecord, ReviewRepository } from "../../repositories/reviews";
import { RATE_LIMIT_POLICIES } from "../rate-limit";
import type { RateLimitKeys, RateLimiter } from "../rate-limit";
import type { ModerationDispatcher, ModerationWorkQueue } from "../ai/moderation";
import type { MovieLocks } from "../catalogue";
import type { AccountId, ContentRevision, MovieId, MovieUpdateLock, Result, ReviewId, RowVersion, Tx } from "../../shared";
import type { ReviewCreateInput, ReviewPatchInput } from "./review-input";

export type ReviewCreateRejection =
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict" }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number };

export type ReviewEditRejection =
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict" }
  | { readonly kind: "stale_version" }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number };

export type ReviewDeleteRejection = ReviewEditRejection;
export type ReviewMutationAdmission = { readonly ok: true } | { readonly ok: false; readonly error: { readonly kind: "rate_limited"; readonly retryAfterSeconds: number } };

export interface ReviewService {
  admit(authorId: AccountId): Promise<ReviewMutationAdmission>;
  create(movieId: MovieId, authorId: AccountId, input: ReviewCreateInput): Promise<Result<ReviewRecord, ReviewCreateRejection>>;
  edit(reviewId: ReviewId, authorId: AccountId, expectedVersion: RowVersion, input: ReviewPatchInput): Promise<Result<ReviewRecord, ReviewEditRejection>>;
  delete(reviewId: ReviewId, authorId: AccountId, expectedVersion: RowVersion): Promise<Result<ReviewRecord, ReviewDeleteRejection>>;
}

export interface ReviewServiceDependencies {
  readonly database: Pick<Database, "withTransactionResult">;
  readonly accounts: Pick<AccountRepository, "lockActiveUserShared">;
  readonly reviews: Pick<ReviewRepository, "findById" | "findForWrite" | "findForAuthorWrite" | "insert" | "restoreDeleted" | "updateRatingOnly" | "updateBody" | "softDelete">;
  readonly movieLocks: Pick<MovieLocks, "lockActiveMovieForUpdate">;
  readonly reviewsChangedMarker: { markReviewsChanged(tx: Tx, movie: MovieUpdateLock): Promise<unknown> };
  readonly moderationWorkQueue: Pick<ModerationWorkQueue, "enqueue" | "cancelForDeletedReview">;
  readonly moderationDispatcher: Pick<ModerationDispatcher, "attemptAfterCommit">;
  readonly rateLimiter: RateLimiter;
  readonly rateLimitKeys: RateLimitKeys;
}

export function createReviewService(deps: ReviewServiceDependencies): ReviewService {
  return {
    async admit(authorId) {
      const admission = await deps.rateLimiter.consume(
        deps.rateLimitKeys.forAccount("review_mutation", authorId),
        RATE_LIMIT_POLICIES.review_mutation,
        1,
      );
      return admission.allowed ? { ok: true } : { ok: false, error: { kind: "rate_limited", retryAfterSeconds: admission.retryAfterSeconds } };
    },
    async create(movieId, authorId, input) {
      const saved = await deps.database.withTransactionResult<ReviewRecord, ReviewCreateRejection>(async (tx) => {
        if ((await deps.accounts.lockActiveUserShared(tx, authorId)) === null) {
          return { ok: false, error: { kind: "forbidden" } };
        }
        const movie = await deps.movieLocks.lockActiveMovieForUpdate(tx, movieId);
        if (!movie.ok) return { ok: false, error: { kind: "not_found" } };

        const existing = await deps.reviews.findForWrite(tx, movieId, authorId);
        let review: ReviewRecord;
        if (existing === null) {
          review = await deps.reviews.insert(tx, movieId, authorId, input);
        } else if (existing.deletedAt !== null && existing.hiddenAt === null) {
          review = await deps.reviews.restoreDeleted(tx, existing.id, input);
        } else {
          return { ok: false, error: { kind: "conflict" } };
        }

        await deps.moderationWorkQueue.enqueue(tx, review.id, review.contentRevision);
        // A pending Review is not publicly eligible, so D-51 does not advance Movie.reviews_revision.
        return { ok: true, value: review };
      });

      if (!saved.ok) return saved;
      await attemptAfterCommit(deps.moderationDispatcher, saved.value.id, saved.value.contentRevision);
      return saved;
    },
    async edit(reviewId, authorId, expectedVersion, input) {
      const saved = await deps.database.withTransactionResult<ReviewRecord, ReviewEditRejection>(async (tx) => {
        if ((await deps.accounts.lockActiveUserShared(tx, authorId)) === null) return { ok: false, error: { kind: "not_found" } };
        const current = await deps.reviews.findById(tx, reviewId);
        if (current === null || current.authorId !== authorId) return { ok: false, error: { kind: "not_found" } };
        const movie = await deps.movieLocks.lockActiveMovieForUpdate(tx, current.movieId);
        if (!movie.ok) return { ok: false, error: { kind: "not_found" } };
        const locked = await deps.reviews.findForAuthorWrite(tx, reviewId, authorId);
        if (locked === null) return { ok: false, error: { kind: "not_found" } };
        if (locked.version !== expectedVersion) return { ok: false, error: { kind: "stale_version" } };
        if (locked.deletedAt !== null) return { ok: false, error: { kind: "conflict" } };

        const rating = input.rating ?? locked.rating;
        const bodyChanged = input.body !== undefined && input.body !== locked.body;
        const ratingChanged = input.rating !== undefined && input.rating !== locked.rating;
        if (!bodyChanged && !ratingChanged) return { ok: true, value: locked };

        const wasEligible = isEligible(locked);
        if (bodyChanged) {
          const updated = await deps.reviews.updateBody(tx, reviewId, rating, input.body as string);
          if (wasEligible) await deps.reviewsChangedMarker.markReviewsChanged(tx, movie.value);
          await deps.moderationWorkQueue.enqueue(tx, updated.id, updated.contentRevision);
          return { ok: true, value: updated };
        }

        const updated = await deps.reviews.updateRatingOnly(tx, reviewId, rating);
        if (wasEligible) await deps.reviewsChangedMarker.markReviewsChanged(tx, movie.value);
        return { ok: true, value: updated };
      });

      if (!saved.ok) return saved;
      if (input.body !== undefined && saved.value.version !== expectedVersion && saved.value.moderationState === "pending") {
        await attemptAfterCommit(deps.moderationDispatcher, saved.value.id, saved.value.contentRevision);
      }
      return saved;
    },
    async delete(reviewId, authorId, expectedVersion) {
      return deps.database.withTransactionResult<ReviewRecord, ReviewDeleteRejection>(async (tx) => {
        if ((await deps.accounts.lockActiveUserShared(tx, authorId)) === null) return { ok: false, error: { kind: "not_found" } };
        const current = await deps.reviews.findById(tx, reviewId);
        if (current === null || current.authorId !== authorId) return { ok: false, error: { kind: "not_found" } };
        const movie = await deps.movieLocks.lockActiveMovieForUpdate(tx, current.movieId);
        if (!movie.ok) return { ok: false, error: { kind: "not_found" } };
        const locked = await deps.reviews.findForAuthorWrite(tx, reviewId, authorId);
        if (locked === null) return { ok: false, error: { kind: "not_found" } };
        if (locked.version !== expectedVersion) return { ok: false, error: { kind: "stale_version" } };
        if (locked.deletedAt !== null) return { ok: true, value: locked };
        const wasEligible = isEligible(locked);
        const deleted = await deps.reviews.softDelete(tx, reviewId);
        await deps.moderationWorkQueue.cancelForDeletedReview(tx, reviewId);
        if (wasEligible) await deps.reviewsChangedMarker.markReviewsChanged(tx, movie.value);
        return { ok: true, value: deleted };
      });
    },
  };
}

function isEligible(review: ReviewRecord): boolean {
  return review.deletedAt === null && review.hiddenAt === null && review.moderationState === "cleared";
}

async function attemptAfterCommit(
  dispatcher: Pick<ModerationDispatcher, "attemptAfterCommit">,
  reviewId: ReviewId,
  contentRevision: ContentRevision,
): Promise<void> {
  try {
    await dispatcher.attemptAfterCommit(reviewId, contentRevision);
  } catch {
    // The Review and durable work have already committed; dispatch is recovered by the sweep.
  }
}
