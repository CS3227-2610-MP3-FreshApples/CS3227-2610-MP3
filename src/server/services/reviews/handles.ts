import "server-only";

import type { ContentRevision, MovieUpdateLock, ReviewId, ReviewUpdateLock, RowVersion } from "../../shared";

/** The Reviews module's only constructor for a ReviewUpdateLock handle. */
export function reviewUpdateLock(
  reviewId: ReviewId,
  movie: MovieUpdateLock,
  version: RowVersion,
  contentRevision: ContentRevision,
  moderationState: ReviewUpdateLock["moderationState"],
  hidden: boolean,
  deleted: boolean,
): ReviewUpdateLock {
  return { reviewId, movie, version, contentRevision, moderationState, hidden, deleted } as ReviewUpdateLock;
}
