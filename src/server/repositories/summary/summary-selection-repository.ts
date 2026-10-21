import "server-only";

import type { Sql } from "../../db";
import type { MovieId, Tx } from "../../shared";
import { currentSummaryExists, retiredSummaryExists } from "./current-summary";

/** What one sweep selects with (D-89, D-94). */
export interface SummarySelectionCriteria {
  readonly promptVersion: string;
  /** `AI_SUMMARY_INTERVAL_DAYS`: 1 or 7. */
  readonly intervalDays: number;
  /** `AI_SUMMARY_MAX_MOVIES_PER_RUN`. */
  readonly limit: number;
}

/** The database clock for schedule writes (D-94 L4): never the server clock. */
export interface ScheduleClock {
  readonly now: Date;
  readonly oneDayLater: Date;
}

/** Read-only sweep queries (D-89, D-94). Takes no row lock. */
export interface SummarySelectionRepository {
  /** Due active Movies in D-89 order, at most `limit`. */
  selectDue(tx: Tx, criteria: SummarySelectionCriteria): Promise<readonly MovieId[]>;
  readScheduleClock(tx: Tx): Promise<ScheduleClock>;
}

// D-89 as amended by D-94 and D-98. Both due checks allow for the hour in which Hobby cron fires. A Movie is due
// for a pending change or for a retired summary with no current one. The eligible-count subquery stops at 3 and
// restates U-01's predicate (D-86); the parity test keeps the copies aligned. Nulls sort last for pending time.
const SELECT_DUE = `
  SELECT m.id
  FROM app.movie m
  WHERE m.archived_at IS NULL
    AND (m.summary_next_attempt_at IS NULL OR m.summary_next_attempt_at <= now() + interval '1 hour')
    AND (m.summary_last_success_at IS NULL
         OR m.summary_last_success_at <= now() + interval '1 hour' - make_interval(days => $2::integer))
    AND (m.summary_pending_since IS NOT NULL
         OR (${retiredSummaryExists({ movieId: "m.id", reviewsRevision: "m.reviews_revision", promptVersion: "$1" })}
             AND NOT ${currentSummaryExists({ movieId: "m.id", reviewsRevision: "m.reviews_revision", promptVersion: "$1" })}))
    AND (
      SELECT count(*)
      FROM (
        SELECT 1
        FROM app.review r
        WHERE r.movie_id = m.id
          AND r.moderation_state = 'cleared'
          AND r.deleted_at IS NULL
          AND r.hidden_at IS NULL
        LIMIT 3
      ) eligible
    ) >= 3
  ORDER BY m.summary_last_attempt_at ASC NULLS FIRST, m.summary_pending_since ASC NULLS LAST, m.id ASC
  LIMIT $3`;

const READ_SCHEDULE_CLOCK = `SELECT now() AS now, now() + interval '1 day' AS one_day_later`;

export function createSummarySelectionRepository(deps: { readonly sql: Sql }): SummarySelectionRepository {
  return {
    async selectDue(tx, criteria) {
      const rows = await deps.sql.query<{ id: MovieId }>(tx, SELECT_DUE, [
        criteria.promptVersion,
        criteria.intervalDays,
        criteria.limit,
      ]);
      return rows.map(({ id }) => id);
    },
    async readScheduleClock(tx) {
      const rows = await deps.sql.query<{ now: Date; one_day_later: Date }>(tx, READ_SCHEDULE_CLOCK, []);
      const row = rows[0] as { now: Date; one_day_later: Date };
      return { now: row.now, oneDayLater: row.one_day_later };
    },
  };
}
