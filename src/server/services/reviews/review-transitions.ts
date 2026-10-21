import "server-only";

import type { ReviewRepository, ReviewTransitionRow } from "../../repositories/reviews";
import { reviewUpdateLock } from "./handles";
import type { MovieLocks } from "../catalogue";
import type {
  ContentRevision,
  MovieUpdateLock,
  ReviewId,
  ReviewUpdateLock,
  RowVersion,
  Result,
  Tx,
} from "../../shared";
import type { ModerationState } from "../../shared";

export interface ReviewLocks {
  lockReviewForTransition(tx: Tx, reviewId: ReviewId): Promise<Result<ReviewUpdateLock, { readonly kind: "not_found" }>>;
  lockReviewsOfMovie(tx: Tx, movie: MovieUpdateLock): Promise<void>;
}

export interface CapturedReviewVersion {
  readonly contentRevision: ContentRevision;
  readonly version: RowVersion;
}

export interface ReviewTransitionResult {
  readonly reviewId: ReviewId;
  readonly version: RowVersion;
  readonly moderationState: ModerationState;
  readonly hidden: boolean;
  readonly deleted: boolean;
  readonly eligibilityChanged: boolean;
}

export type AutomaticRejection = { readonly kind: "stale" } | { readonly kind: "movie_archived" };
export type AdminRejection = { readonly kind: "stale_version" } | { readonly kind: "conflict" };

export interface ReviewTransitions {
  applyAutomaticClearance(tx: Tx, review: ReviewUpdateLock, captured: CapturedReviewVersion): Promise<Result<ReviewTransitionResult, AutomaticRejection>>;
  applyAutomaticFlag(tx: Tx, review: ReviewUpdateLock, captured: CapturedReviewVersion): Promise<Result<ReviewTransitionResult, AutomaticRejection>>;
  approveHeldReview(tx: Tx, review: ReviewUpdateLock, expected: RowVersion): Promise<Result<ReviewTransitionResult, AdminRejection>>;
  hideReview(tx: Tx, review: ReviewUpdateLock, expected: RowVersion): Promise<Result<ReviewTransitionResult, AdminRejection>>;
  restoreHiddenReview(tx: Tx, review: ReviewUpdateLock, expected: RowVersion): Promise<Result<ReviewTransitionResult, AdminRejection>>;
  hideReviewForAcceptedReport(tx: Tx, review: ReviewUpdateLock): Promise<ReviewTransitionResult>;
}

export interface ScreeningSource {
  readonly reviewId: ReviewId;
  readonly contentRevision: ContentRevision;
  readonly version: RowVersion;
  readonly body: string;
  readonly moderationState: ModerationState;
  readonly hidden: boolean;
  readonly deleted: boolean;
  readonly movieArchived: boolean;
}

export interface ReviewModerationReads {
  readReviewForScreening(tx: Tx, reviewId: ReviewId): Promise<Result<ScreeningSource, { readonly kind: "not_found" }>>;
}

export interface ReviewLocksAndReads extends ReviewLocks, ReviewModerationReads {}

export interface AutomaticReviewTransitions {
  applyAutomaticClearance(tx: Tx, review: ReviewUpdateLock, captured: CapturedReviewVersion): Promise<Result<ReviewTransitionResult, AutomaticRejection>>;
  applyAutomaticFlag(tx: Tx, review: ReviewUpdateLock, captured: CapturedReviewVersion): Promise<Result<ReviewTransitionResult, AutomaticRejection>>;
}

export interface AdminReviewTransitions {
  approveHeldReview(tx: Tx, review: ReviewUpdateLock, expected: RowVersion): Promise<Result<ReviewTransitionResult, AdminRejection>>;
  hideReview(tx: Tx, review: ReviewUpdateLock, expected: RowVersion): Promise<Result<ReviewTransitionResult, AdminRejection>>;
  restoreHiddenReview(tx: Tx, review: ReviewUpdateLock, expected: RowVersion): Promise<Result<ReviewTransitionResult, AdminRejection>>;
  hideReviewForAcceptedReport(tx: Tx, review: ReviewUpdateLock): Promise<ReviewTransitionResult>;
}

export function createAdminReviewTransitions(deps: {
  readonly reviews: Pick<ReviewRepository, "approveAdmin" | "hideAdmin" | "restoreAdmin" | "hideForAcceptedReport">;
  readonly reviewsChangedMarker: { markReviewsChanged(tx: Tx, movie: MovieUpdateLock): Promise<unknown> };
}): AdminReviewTransitions {
  return {
    approveHeldReview(tx, review, expected) {
      if (review.version !== expected) return Promise.resolve({ ok: false, error: { kind: "stale_version" } });
      if (review.moderationState === "cleared") return Promise.resolve({ ok: true, value: noOpResult(review) });
      return applyAdmin(deps, tx, review, deps.reviews.approveAdmin, isEligible(review));
    },
    hideReview(tx, review, expected) {
      if (review.version !== expected) return Promise.resolve({ ok: false, error: { kind: "stale_version" } });
      if (review.hidden) return Promise.resolve({ ok: true, value: noOpResult(review) });
      return applyAdmin(deps, tx, review, deps.reviews.hideAdmin, isEligible(review));
    },
    restoreHiddenReview(tx, review, expected) {
      if (review.version !== expected) return Promise.resolve({ ok: false, error: { kind: "stale_version" } });
      if (!review.hidden) return Promise.resolve({ ok: true, value: noOpResult(review) });
      return applyAdmin(deps, tx, review, deps.reviews.restoreAdmin, isEligible(review));
    },
    async hideReviewForAcceptedReport(tx, review) {
      if (review.hidden) return noOpResult(review);
      const updated = await deps.reviews.hideForAcceptedReport(tx, review);
      if (updated === null) throw new Error("accepted-report review hide lost its locked row");
      const eligibilityChanged = isEligible(review) !== isEligibleRow(updated, review.movie.archived);
      if (eligibilityChanged) await deps.reviewsChangedMarker.markReviewsChanged(tx, review.movie);
      return toTransitionResult(updated, eligibilityChanged);
    },
  };
}

export function createReviewTransitions(deps: {
  readonly reviews: Pick<ReviewRepository, "applyAutomatic" | "approveAdmin" | "hideAdmin" | "restoreAdmin" | "hideForAcceptedReport">;
  readonly reviewsChangedMarker: { markReviewsChanged(tx: Tx, movie: MovieUpdateLock): Promise<unknown> };
}): ReviewTransitions {
  return {
    ...createAutomaticReviewTransitions(deps),
    ...createAdminReviewTransitions(deps),
  };
}

async function applyAdmin(
  deps: {
    readonly reviewsChangedMarker: { markReviewsChanged(tx: Tx, movie: MovieUpdateLock): Promise<unknown> };
  },
  tx: Tx,
  review: ReviewUpdateLock,
  write: (tx: Tx, review: ReviewUpdateLock) => Promise<ReviewTransitionRow | null>,
  eligibleBefore: boolean,
): Promise<Result<ReviewTransitionResult, AdminRejection>> {
  const updated = await write(tx, review);
  if (updated === null) return { ok: false, error: { kind: "stale_version" } };
  const eligibleAfter = isEligibleRow(updated, review.movie.archived);
  const eligibilityChanged = eligibleBefore !== eligibleAfter;
  if (eligibilityChanged) await deps.reviewsChangedMarker.markReviewsChanged(tx, review.movie);
  return { ok: true, value: toTransitionResult(updated, eligibilityChanged) };
}

function isEligible(review: ReviewUpdateLock): boolean {
  return review.moderationState === "cleared" && !review.hidden && !review.deleted && !review.movie.archived;
}

function isEligibleRow(row: ReviewTransitionRow, movieArchived: boolean): boolean {
  return row.moderation_state === "cleared" && row.hidden_at === null && row.deleted_at === null && !movieArchived;
}

function noOpResult(review: ReviewUpdateLock): ReviewTransitionResult {
  return {
    reviewId: review.reviewId,
    version: review.version,
    moderationState: review.moderationState,
    hidden: review.hidden,
    deleted: review.deleted,
    eligibilityChanged: false,
  };
}

export function createAutomaticReviewTransitions(deps: {
  readonly reviews: Pick<ReviewRepository, "applyAutomatic">;
  readonly reviewsChangedMarker: { markReviewsChanged(tx: Tx, movie: MovieUpdateLock): Promise<unknown> };
}): AutomaticReviewTransitions {
  return {
    applyAutomaticClearance(tx, review, captured) {
      return applyAutomatic(deps, tx, review, captured, "cleared");
    },
    applyAutomaticFlag(tx, review, captured) {
      return applyAutomatic(deps, tx, review, captured, "flagged");
    },
  };
}

async function applyAutomatic(
  deps: {
    readonly reviews: Pick<ReviewRepository, "applyAutomatic">;
    readonly reviewsChangedMarker: { markReviewsChanged(tx: Tx, movie: MovieUpdateLock): Promise<unknown> };
  },
  tx: Tx,
  review: ReviewUpdateLock,
  captured: CapturedReviewVersion,
  state: Extract<ModerationState, "cleared" | "flagged">,
): Promise<Result<ReviewTransitionResult, AutomaticRejection>> {
  if (review.movie.archived) return { ok: false, error: { kind: "movie_archived" } };
  if (
    review.moderationState !== "pending" ||
    review.hidden ||
    review.deleted ||
    review.contentRevision !== captured.contentRevision ||
    review.version !== captured.version
  ) {
    return { ok: false, error: { kind: "stale" } };
  }

  const updated = await deps.reviews.applyAutomatic(tx, review, state);
  if (updated === null) return { ok: false, error: { kind: "stale" } };
  const eligibilityChanged = state === "cleared" && !updated.hidden_at && !updated.deleted_at;
  if (eligibilityChanged) await deps.reviewsChangedMarker.markReviewsChanged(tx, review.movie);
  return { ok: true, value: toTransitionResult(updated, eligibilityChanged) };
}

function toTransitionResult(row: ReviewTransitionRow, eligibilityChanged: boolean): ReviewTransitionResult {
  return {
    reviewId: row.id,
    version: row.version,
    moderationState: row.moderation_state,
    hidden: row.hidden_at !== null,
    deleted: row.deleted_at !== null,
    eligibilityChanged,
  };
}

export function createReviewLocksAndReads(deps: {
  readonly reviews: Pick<ReviewRepository, "findById" | "lockForTransition" | "lockAllForMovie" | "readForScreening">;
  readonly movieLocks: Pick<MovieLocks, "lockMovieForUpdate">;
}): ReviewLocksAndReads {
  return {
    async lockReviewForTransition(tx, reviewId) {
      const current = await deps.reviews.findById(tx, reviewId);
      if (current === null) return { ok: false, error: { kind: "not_found" } };
      const movie = await deps.movieLocks.lockMovieForUpdate(tx, current.movieId);
      if (!movie.ok) return { ok: false, error: { kind: "not_found" } };
      const locked = await deps.reviews.lockForTransition(tx, reviewId, movie.value);
      if (locked === null) return { ok: false, error: { kind: "not_found" } };
      return {
        ok: true,
        value: reviewUpdateLock(
          reviewId,
          movie.value,
          locked.version,
          locked.content_revision,
          locked.moderation_state,
          locked.hidden_at !== null,
          locked.deleted_at !== null,
        ),
      };
    },
    lockReviewsOfMovie(tx, movie) {
      return deps.reviews.lockAllForMovie(tx, movie);
    },
    async readReviewForScreening(tx, reviewId) {
      const row = await deps.reviews.readForScreening(tx, reviewId);
      return row === null
        ? { ok: false, error: { kind: "not_found" } }
        : {
            ok: true,
            value: {
              reviewId: row.id,
              contentRevision: row.content_revision,
              version: row.version,
              body: row.body,
              moderationState: row.moderation_state,
              hidden: row.hidden_at !== null,
              deleted: row.deleted_at !== null,
              movieArchived: row.movie_archived,
            },
          };
    },
  };
}
