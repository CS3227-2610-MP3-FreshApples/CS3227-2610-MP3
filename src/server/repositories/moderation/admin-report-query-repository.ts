import "server-only";

import type { Sql, SqlParam } from "../../db";
import { parseEvidenceSnapshot, type EvidenceSnapshot } from "../../services/moderation/report-evidence";
import type { AdminReportFilters } from "../../services/moderation/admin-report-input";
import type { AccountId, ModerationState, MovieId, ReportCategory, ReportId, ReportStatus, ReviewId, RowVersion, Tx } from "../../shared";

export interface AdminReportListItem {
  readonly id: ReportId;
  readonly status: ReportStatus;
  readonly category: ReportCategory;
  readonly createdAt: string;
  readonly version: RowVersion;
  readonly reporter: { readonly id: AccountId; readonly displayName: string };
  readonly target: { readonly id: AccountId; readonly displayName: string; readonly status: "active" | "suspended" };
  readonly review: { readonly id: ReviewId; readonly movieId: MovieId; readonly movieTitle: string; readonly state: "pending" | "flagged" | "cleared" | "hidden" | "deleted" };
}

export interface AdminReportDetail extends AdminReportListItem {
  readonly explanation: string;
  readonly evidence: EvidenceSnapshot;
  readonly liveReview: {
    readonly version: RowVersion;
    readonly moderationState: ModerationState;
    readonly hidden: boolean;
    readonly deleted: boolean;
    readonly movieArchived: boolean;
  };
  readonly target: AdminReportListItem["target"] & { readonly strikeCount: number; readonly strikeThreshold: number };
  readonly projectedEffect: {
    readonly strikeAdded: boolean;
    readonly strikeCountAfter: number;
    readonly wouldSuspend: boolean;
    readonly accountStatusAfter: "active" | "suspended";
  };
  readonly decision: {
    readonly id: string;
    readonly disposition: "accepted" | "dismissed";
    readonly actions: readonly string[];
    readonly reason: string;
    readonly createdAt: string;
  } | null;
}

export interface AdminReportQueryRepository {
  list(tx: Tx, filters: AdminReportFilters, limit: number, offset: number): Promise<readonly AdminReportListItem[]>;
  count(tx: Tx, filters: AdminReportFilters): Promise<number>;
  get(tx: Tx, reportId: ReportId): Promise<AdminReportDetail | null>;
}

interface ReportRow {
  id: ReportId; status: ReportStatus; category: ReportCategory; explanation: string; evidence_snapshot: unknown;
  version: RowVersion; created_at: Date; reporter_id: AccountId; reporter_display_name: string;
  target_user_id: AccountId; target_display_name: string; target_status: "active" | "suspended"; target_strike_cycle: number;
  review_id: ReviewId; movie_id: MovieId; movie_title: string; review_version: RowVersion;
  review_moderation_state: ModerationState; review_hidden: boolean; review_deleted: boolean; movie_archived: boolean;
  strike_count: number; existing_strike: boolean; decision_id: string | null;
  decision_disposition: "accepted" | "dismissed" | null; decision_actions: string[] | null;
  decision_reason: string | null; decision_created_at: Date | null;
}

const FROM = `
  FROM app.report r
  JOIN app.account reporter ON reporter.id = r.reporter_id
  JOIN app.account target ON target.id = r.target_user_id
  JOIN app.review review ON review.id = r.review_id
  JOIN app.movie movie ON movie.id = review.movie_id
  LEFT JOIN app.moderation_decision decision ON decision.report_id = r.id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS strike_count
    FROM app.moderation_strike strike
    WHERE strike.target_user_id = r.target_user_id AND strike.strike_cycle = target.strike_cycle
  ) strikes ON true
  LEFT JOIN LATERAL (
    SELECT true AS existing_strike
    FROM app.moderation_strike strike
    WHERE strike.target_user_id = r.target_user_id AND strike.review_id = r.review_id
    LIMIT 1
  ) existing ON true`;

const SELECT = `
  SELECT r.id, r.status, r.category, r.explanation, r.evidence_snapshot, r.version, r.created_at,
         reporter.id AS reporter_id, reporter.display_name AS reporter_display_name,
         target.id AS target_user_id, target.display_name AS target_display_name, target.status AS target_status,
         target.strike_cycle AS target_strike_cycle,
         review.id AS review_id, movie.id AS movie_id, movie.title AS movie_title, review.version AS review_version,
         review.moderation_state AS review_moderation_state, review.hidden_at IS NOT NULL AS review_hidden,
         review.deleted_at IS NOT NULL AS review_deleted, movie.archived_at IS NOT NULL AS movie_archived,
         coalesce(strikes.strike_count, 0) AS strike_count, coalesce(existing.existing_strike, false) AS existing_strike,
         decision.id AS decision_id, decision.disposition AS decision_disposition, decision.actions AS decision_actions,
         decision.reason AS decision_reason, decision.created_at AS decision_created_at`;

function predicates(filters: AdminReportFilters): { readonly text: string; readonly params: readonly SqlParam[] } {
  const params: SqlParam[] = [];
  const conditions: string[] = [];
  if (filters.status !== "all") {
    params.push(filters.status);
    conditions.push(`r.status = $${params.length}`);
  }
  if (filters.category !== null) {
    params.push(filters.category);
    conditions.push(`r.category = $${params.length}`);
  }
  return { text: conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`, params };
}

function reviewState(row: ReportRow): AdminReportListItem["review"]["state"] {
  if (row.review_deleted) return "deleted";
  if (row.review_hidden) return "hidden";
  return row.review_moderation_state;
}

function toListItem(row: ReportRow): AdminReportListItem {
  return {
    id: row.id, status: row.status, category: row.category, createdAt: row.created_at.toISOString(), version: row.version,
    reporter: { id: row.reporter_id, displayName: row.reporter_display_name },
    target: { id: row.target_user_id, displayName: row.target_display_name, status: row.target_status },
    review: { id: row.review_id, movieId: row.movie_id, movieTitle: row.movie_title, state: reviewState(row) },
  };
}

function toDetail(row: ReportRow, strikeThreshold: number): AdminReportDetail {
  const evidence = parseEvidenceSnapshot(row.evidence_snapshot);
  if (!evidence.ok) throw new Error("stored report evidence is invalid");
  const strikeAdded = !row.existing_strike;
  const strikeCountAfter = row.strike_count + (strikeAdded ? 1 : 0);
  const wouldSuspend = row.status === "open" && row.target_status === "active" && strikeCountAfter >= strikeThreshold;
  return {
    ...toListItem(row),
    explanation: row.explanation,
    evidence: evidence.value,
    liveReview: {
      version: row.review_version, moderationState: row.review_moderation_state, hidden: row.review_hidden,
      deleted: row.review_deleted, movieArchived: row.movie_archived,
    },
    target: {
      id: row.target_user_id, displayName: row.target_display_name, status: row.target_status,
      strikeCount: row.strike_count, strikeThreshold,
    },
    projectedEffect: {
      strikeAdded, strikeCountAfter, wouldSuspend,
      accountStatusAfter: wouldSuspend ? "suspended" : row.target_status,
    },
    decision: row.decision_id === null ? null : {
      id: row.decision_id, disposition: row.decision_disposition!, actions: row.decision_actions ?? [],
      reason: row.decision_reason!, createdAt: row.decision_created_at!.toISOString(),
    },
  };
}

export function createAdminReportQueryRepository({ sql, strikeThreshold }: { readonly sql: Sql; readonly strikeThreshold: number }): AdminReportQueryRepository {
  return {
    async list(tx, filters, limit, offset) {
      const where = predicates(filters);
      const rows = await sql.query<ReportRow>(tx, `${SELECT} ${FROM} ${where.text} ORDER BY r.created_at DESC, r.id ASC LIMIT $${where.params.length + 1} OFFSET $${where.params.length + 2}`, [...where.params, limit, offset]);
      return rows.map(toListItem);
    },
    async count(tx, filters) {
      const where = predicates(filters);
      const rows = await sql.query<{ total: number }>(tx, `SELECT count(*)::integer AS total ${FROM} ${where.text}`, where.params);
      return rows[0]?.total ?? 0;
    },
    async get(tx, reportId) {
      const rows = await sql.query<ReportRow>(tx, `${SELECT} ${FROM} WHERE r.id = $1`, [reportId]);
      return rows[0] === undefined ? null : toDetail(rows[0], strikeThreshold);
    },
  };
}
