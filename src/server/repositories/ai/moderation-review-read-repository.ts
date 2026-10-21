import "server-only";

import type { Sql } from "../../db";
import type { AccountId, ReviewId, Tx } from "../../shared";

/**
 * Reads the moderation module needs from Review rows (D-101). Reads only: Review writes and locks stay with K8.
 * Kept apart from the ModerationWork repository, which never reads a Review or Movie row (D-58).
 */
export interface ModerationReviewReadRepository {
  /** The Review's author, the AIJob requester for `review_write` (D-64). `null` for an unknown Review. */
  readAuthorId(tx: Tx, reviewId: ReviewId): Promise<AccountId | null>;
}

const READ_AUTHOR_ID = "SELECT author_id FROM app.review WHERE id = $1";

export function createModerationReviewReadRepository(deps: { sql: Sql }): ModerationReviewReadRepository {
  const { sql } = deps;
  return {
    async readAuthorId(tx, reviewId) {
      const rows = await sql.query<{ author_id: AccountId }>(tx, READ_AUTHOR_ID, [reviewId]);
      return rows[0]?.author_id ?? null;
    },
  };
}
