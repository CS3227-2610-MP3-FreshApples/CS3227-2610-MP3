import "server-only";

import type { Sql } from "../../db";
import type { AccountId, MovieId, ReportId, ReportStatus, ReviewId, RowVersion, Tx } from "../../shared";

export interface AdminReportDecisionTarget { readonly reportId: ReportId; readonly targetUserId: AccountId; readonly reviewId: ReviewId; readonly movieId: MovieId; readonly version: RowVersion }
export interface LockedAdminReportDecision extends AdminReportDecisionTarget { readonly status: ReportStatus; readonly targetStatus?: "active" | "suspended" }
export interface AdminReportMutationRepository {
  findDecisionTarget(tx: Tx, reportId: ReportId): Promise<AdminReportDecisionTarget | null>;
  lockDecision(tx: Tx, reportId: ReportId): Promise<LockedAdminReportDecision | null>;
  countCurrentCycleStrikes(tx: Tx, targetUserId: AccountId, strikeCycle: number): Promise<number>;
  insertDecision(tx: Tx, input: { readonly reportId: ReportId; readonly adminId: AccountId; readonly disposition: "accepted" | "dismissed"; readonly actions: readonly string[]; readonly reason: string }): Promise<string>;
  insertStrike(tx: Tx, input: { readonly targetUserId: AccountId; readonly reviewId: ReviewId; readonly acceptedReportId: ReportId; readonly strikeCycle: number }): Promise<boolean>;
  close(tx: Tx, reportId: ReportId, expectedVersion: RowVersion, status: Extract<ReportStatus, "accepted" | "dismissed">): Promise<RowVersion>;
}

interface TargetRow { report_id: ReportId; target_user_id: AccountId; review_id: ReviewId; movie_id: MovieId; version: number }
interface LockedRow extends TargetRow { status: ReportStatus; target_status: "active" | "suspended" }

export function createAdminReportMutationRepository({ sql }: { readonly sql: Sql }): AdminReportMutationRepository {
  return {
    async findDecisionTarget(tx, reportId) {
      const row = (await sql.query<TargetRow>(tx, `SELECT r.id AS report_id, r.target_user_id, r.review_id, review.movie_id, r.version FROM app.report r JOIN app.review review ON review.id = r.review_id WHERE r.id = $1`, [reportId]))[0];
      return row === undefined ? null : toTarget(row);
    },
    async lockDecision(tx, reportId) {
      const row = (await sql.query<LockedRow>(tx, `SELECT r.id AS report_id, r.target_user_id, r.review_id, review.movie_id, r.version, r.status, target.status AS target_status FROM app.report r JOIN app.review review ON review.id = r.review_id JOIN app.account target ON target.id = r.target_user_id WHERE r.id = $1 FOR UPDATE OF r`, [reportId]))[0];
      return row === undefined ? null : { ...toTarget(row), status: row.status, targetStatus: row.target_status };
    },
    async countCurrentCycleStrikes(tx, targetUserId, strikeCycle) {
      const row = (await sql.query<{ total: number }>(tx, `SELECT count(*)::integer AS total FROM app.moderation_strike WHERE target_user_id = $1 AND strike_cycle = $2`, [targetUserId, strikeCycle]))[0];
      return row?.total ?? 0;
    },
    async insertDecision(tx, input) {
      const row = (await sql.query<{ id: string }>(tx, `INSERT INTO app.moderation_decision (report_id, admin_id, disposition, actions, reason) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [input.reportId, input.adminId, input.disposition, input.actions, input.reason]))[0];
      if (row === undefined) throw new Error("decision insert returned no row");
      return row.id;
    },
    async insertStrike(tx, input) {
      const rows = await sql.query<{ id: string }>(tx, `INSERT INTO app.moderation_strike (target_user_id, review_id, accepted_report_id, strike_cycle) VALUES ($1, $2, $3, $4) ON CONFLICT (target_user_id, review_id) DO NOTHING RETURNING id`, [input.targetUserId, input.reviewId, input.acceptedReportId, input.strikeCycle]);
      return rows.length > 0;
    },
    async close(tx, reportId, expectedVersion, status) {
      const row = (await sql.query<{ version: number }>(tx, `UPDATE app.report SET status = $2, version = version + 1, updated_at = now() WHERE id = $1 AND version = $3 AND status = 'open' RETURNING version`, [reportId, status, expectedVersion]))[0];
      if (row === undefined) throw new Error("report close lost its locked row");
      return row.version as RowVersion;
    },
  };
}

function toTarget(row: TargetRow): AdminReportDecisionTarget {
  return { reportId: row.report_id, targetUserId: row.target_user_id, reviewId: row.review_id, movieId: row.movie_id, version: row.version as RowVersion };
}
