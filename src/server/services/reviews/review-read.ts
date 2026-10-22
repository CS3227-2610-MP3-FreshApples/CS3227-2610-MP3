import "server-only";

import type { AccountId, MovieId, ModerationState, ReviewId } from "../../shared";
import type { ReviewRecord } from "../../repositories/reviews";

export interface PublicReview {
  readonly id: ReviewId;
  readonly movieId: MovieId;
  readonly author: { readonly id: AccountId; readonly displayName: string };
  readonly rating: number;
  readonly body: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OwnReview extends PublicReview {
  readonly moderationState: ModerationState;
  /** Safe optimistic-concurrency token needed for the owner's PATCH/DELETE actions. */
  readonly version: number;
}

/** Public Review projection from api.md 8.1; private moderation and account fields are omitted. */
export function projectPublicReview(record: ReviewRecord): PublicReview {
  return {
    id: record.id,
    movieId: record.movieId,
    author: { id: record.authorId, displayName: record.authorDisplayName },
    rating: record.rating,
    body: record.body,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Own-Review projection adds only the safe moderation state promised by GET /me/reviews. */
export function projectOwnReview(record: ReviewRecord): OwnReview {
  return { ...projectPublicReview(record), moderationState: record.moderationState, version: record.version };
}
