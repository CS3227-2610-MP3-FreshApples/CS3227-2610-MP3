import "server-only";

import type { Sql } from "../../db";
import type { AccountId, ContentRevision, ReviewId, Tx } from "../../shared";

/** One due ModerationWork item for the recovery sweep (D-101). */
export interface DueModerationWork {
  readonly reviewId: ReviewId;
  readonly contentRevision: ContentRevision;
}

/**
 * Reads the moderation module needs from Review rows (D-101). Reads only: Review writes and locks stay with K8.
 * Kept apart from the ModerationWork repository, which never reads a Review or Movie row (D-58).
 */
export interface ModerationReviewReadRepository {
  /** The Review's author, the AIJob requester for `review_write` (D-64). `null` for an unknown Review. */
  readAuthorId(tx: Tx, reviewId: ReviewId): Promise<AccountId | null>;
  /**
   * The D-101 sweep selection, an unlocked read (D-58): at most `limit` items that are `pending`, or `running`
   * with an expired claim, due by the database clock, whose Review is neither hidden nor deleted (D-54) and whose
   * Movie is active. Never-attempted work first, then the oldest last attempt, then ID.
   */
  selectDue(tx: Tx, limit: number): Promise<readonly DueModerationWork[]>;
}

const READ_AUTHOR_ID = "SELECT author_id FROM app.review WHERE id = $1";

// A `running` row is due only once its claim has expired, because the claim sets next_attempt_at (D-101).
const SELECT_DUE = `
  SELECT work.review_id, work.content_revision
  FROM app.moderation_work AS work
  JOIN app.review AS review ON review.id = work.review_id
  JOIN app.movie AS movie ON movie.id = review.movie_id
  WHERE work.status IN ('pending', 'running')
    AND work.next_attempt_at <= now()
    AND review.hidden_at IS NULL
    AND review.deleted_at IS NULL
    AND movie.archived_at IS NULL
  ORDER BY work.last_attempt_at ASC NULLS FIRST, work.id ASC
  LIMIT $1`;

export function createModerationReviewReadRepository(deps: { sql: Sql }): ModerationReviewReadRepository {
  const { sql } = deps;
  return {
    async readAuthorId(tx, reviewId) {
      const rows = await sql.query<{ author_id: AccountId }>(tx, READ_AUTHOR_ID, [reviewId]);
      return rows[0]?.author_id ?? null;
    },
    async selectDue(tx, limit) {
      const rows = await sql.query<{ review_id: ReviewId; content_revision: ContentRevision }>(tx, SELECT_DUE, [limit]);
      return rows.map((row) => ({ reviewId: row.review_id, contentRevision: row.content_revision }));
    },
  };
}
