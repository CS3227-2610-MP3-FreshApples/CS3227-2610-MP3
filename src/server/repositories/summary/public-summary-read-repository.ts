import "server-only";

import type { Sql } from "../../db";
import type { MovieId, Tx } from "../../shared";
import { currentSummaryRows } from "./current-summary";

/** A current ReviewSummary row as stored. Its JSON is untrusted until the service validates it (D-94 L7). */
export interface StoredCurrentSummary {
  readonly id: string;
  /** ISO 8601 UTC with milliseconds. */
  readonly generatedAt: string;
  readonly output: unknown;
  readonly sample: unknown;
}

/** One statement's view of an active Movie for the D-90 projection. */
export interface PublicSummarySnapshot {
  /** Every eligible Review, counted under the D-86 predicate. */
  readonly eligibleCount: number;
  /** Current rows (D-93), latest first by `generated_at DESC, id DESC` (D-94). */
  readonly currentSummaries: readonly StoredCurrentSummary[];
  /** Whether the Movie has any ReviewSummary at all, current or not. */
  readonly hasAnySummary: boolean;
}

/** Read-only public summary storage boundary (D-90, D-98). Takes no row lock and writes nothing. */
export interface PublicSummaryReadRepository {
  /** Returns null for a missing or archived Movie. */
  readSnapshot(tx: Tx, movieId: MovieId, promptVersion: string): Promise<PublicSummarySnapshot | null>;
}

interface SnapshotRow {
  readonly eligible_count: number;
  readonly current_summaries: StoredCurrentSummary[];
  readonly has_any_summary: boolean;
}

// One statement, so the eligible count, the revision and the summaries share one snapshot (D-90). The eligibility
// predicate restates U-01's (data-model.md; D-86); the parity test keeps the copies aligned. `to_char` keeps the
// timestamp independent of the session time zone.
const READ_SNAPSHOT = `
  SELECT (
           SELECT count(*)
           FROM app.review r
           WHERE r.movie_id = m.id
             AND r.moderation_state = 'cleared'
             AND r.deleted_at IS NULL
             AND r.hidden_at IS NULL
         )::integer AS eligible_count,
         COALESCE((
           SELECT json_agg(
                    json_build_object(
                      'id', cs.id,
                      'generatedAt', to_char(cs.generated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                      'output', cs.output_json,
                      'sample', cs.sampled_review_ids_and_versions)
                    ORDER BY cs.generated_at DESC, cs.id DESC)
           ${currentSummaryRows({ movieId: "m.id", reviewsRevision: "m.reviews_revision", promptVersion: "$2" })}
         ), '[]'::json) AS current_summaries,
         EXISTS (SELECT 1 FROM app.review_summary s WHERE s.movie_id = m.id) AS has_any_summary
  FROM app.movie m
  WHERE m.id = $1 AND m.archived_at IS NULL`;

export function createPublicSummaryReadRepository(deps: { readonly sql: Sql }): PublicSummaryReadRepository {
  return {
    async readSnapshot(tx, movieId, promptVersion) {
      const rows = await deps.sql.query<SnapshotRow>(tx, READ_SNAPSHOT, [movieId, promptVersion]);
      const row = rows[0];
      return row === undefined
        ? null
        : {
            eligibleCount: row.eligible_count,
            currentSummaries: row.current_summaries,
            hasAnySummary: row.has_any_summary,
          };
    },
  };
}
