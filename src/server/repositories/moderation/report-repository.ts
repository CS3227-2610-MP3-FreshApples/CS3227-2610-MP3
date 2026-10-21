import "server-only";

import type { Sql } from "../../db";
import type { AccountId, MovieId, ReportCategory, ReportId, ReportStatus, ReviewId, RowVersion, Tx } from "../../shared";
import type { EvidenceSnapshot } from "../../services/moderation/report-evidence";

export interface ReportReviewTarget {
  readonly reviewId: ReviewId;
  readonly movieId: MovieId;
  readonly movieTitle: string;
  readonly authorId: AccountId;
  readonly reviewVersion: RowVersion;
  readonly rating: number;
  readonly body: string;
  readonly deletedAt: Date | null;
  readonly hiddenAt: Date | null;
  readonly moderationState: "pending" | "flagged" | "cleared";
  readonly movieArchived: boolean;
}

export interface NewReport {
  readonly reporterId: AccountId;
  readonly targetUserId: AccountId;
  readonly reviewId: ReviewId;
  readonly category: ReportCategory;
  readonly explanation: string;
  readonly evidenceSnapshot: EvidenceSnapshot;
}

export interface ReportRecord {
  readonly id: ReportId;
  readonly reporterId: AccountId;
  readonly reviewId: ReviewId;
  readonly category: ReportCategory;
  readonly status: ReportStatus;
  readonly createdAt: Date;
  readonly disposition?: "accepted" | "dismissed";
}

export interface ReportRepository {
  findForReport(tx: Tx, reviewId: ReviewId): Promise<ReportReviewTarget | null>;
  lockForReport(tx: Tx, movieId: MovieId, reviewId: ReviewId): Promise<ReportReviewTarget | null>;
  insert(tx: Tx, report: NewReport): Promise<ReportRecord>;
  listByReporter(tx: Tx, reporterId: AccountId, limit: number, offset: number): Promise<{ readonly items: readonly ReportRecord[]; readonly total: number }>;
  findByReporter(tx: Tx, reporterId: AccountId, reportId: ReportId): Promise<ReportRecord | null>;
}

interface ReportTargetRow {
  readonly review_id: ReviewId;
  readonly movie_id: MovieId;
  readonly movie_title: string;
  readonly author_id: AccountId;
  readonly review_version: number;
  readonly rating: number;
  readonly body: string;
  readonly deleted_at: Date | null;
  readonly hidden_at: Date | null;
  readonly moderation_state: ReportReviewTarget["moderationState"];
  readonly movie_archived: boolean;
}

interface ReportRow {
  readonly id: ReportId;
  readonly reporter_id: AccountId;
  readonly review_id: ReviewId;
  readonly category: ReportCategory;
  readonly status: ReportStatus;
  readonly created_at: Date;
  readonly disposition?: "accepted" | "dismissed" | null;
}

const TARGET_COLUMNS = `r.id AS review_id, r.movie_id, m.title AS movie_title, r.author_id, r.version AS review_version,
  r.rating, r.body, r.deleted_at, r.hidden_at, r.moderation_state, m.archived_at IS NOT NULL AS movie_archived`;
const FIND_TARGET = `SELECT ${TARGET_COLUMNS} FROM app.review r JOIN app.movie m ON m.id = r.movie_id WHERE r.id = $1`;
const LOCK_TARGET = `${FIND_TARGET} AND r.movie_id = $2 FOR SHARE`;
const INSERT_REPORT = `
  INSERT INTO app.report (reporter_id, target_user_id, review_id, category, explanation, evidence_snapshot, evidence_version, status)
  VALUES ($1, $2, $3, $4, $5, $6, 1, 'open')
  RETURNING id, reporter_id, review_id, category, status, created_at`;
const REPORT_COLUMNS = `r.id, r.reporter_id, r.review_id, r.category, r.status, r.created_at,
  d.disposition`;
const LIST_BY_REPORTER = `SELECT ${REPORT_COLUMNS} FROM app.report r LEFT JOIN app.moderation_decision d ON d.report_id = r.id
  WHERE r.reporter_id = $1 ORDER BY r.created_at DESC, r.id ASC LIMIT $2 OFFSET $3`;
const COUNT_BY_REPORTER = `SELECT count(*)::integer AS total FROM app.report WHERE reporter_id = $1`;
const FIND_BY_REPORTER = `SELECT ${REPORT_COLUMNS} FROM app.report r LEFT JOIN app.moderation_decision d ON d.report_id = r.id
  WHERE r.reporter_id = $1 AND r.id = $2`;

function toTarget(row: ReportTargetRow): ReportReviewTarget {
  return {
    reviewId: row.review_id,
    movieId: row.movie_id,
    movieTitle: row.movie_title,
    authorId: row.author_id,
    reviewVersion: row.review_version as RowVersion,
    rating: row.rating,
    body: row.body,
    deletedAt: row.deleted_at,
    hiddenAt: row.hidden_at,
    moderationState: row.moderation_state,
    movieArchived: row.movie_archived,
  };
}

export function createReportRepository({ sql }: { readonly sql: Sql }): ReportRepository {
  return {
    async findForReport(tx, reviewId) {
      const row = (await sql.query<ReportTargetRow>(tx, FIND_TARGET, [reviewId]))[0];
      return row === undefined ? null : toTarget(row);
    },
    async lockForReport(tx, movieId, reviewId) {
      const row = (await sql.query<ReportTargetRow>(tx, LOCK_TARGET, [reviewId, movieId]))[0];
      return row === undefined ? null : toTarget(row);
    },
    async insert(tx, report) {
      const row = (await sql.query<ReportRow>(tx, INSERT_REPORT, [
        report.reporterId,
        report.targetUserId,
        report.reviewId,
        report.category,
        report.explanation,
        JSON.stringify(report.evidenceSnapshot),
      ]))[0];
      if (row === undefined) throw new Error("report insert returned no row");
      return toReportRecord(row);
    },
    async listByReporter(tx, reporterId, limit, offset) {
      const [items, count] = await Promise.all([
        sql.query<ReportRow>(tx, LIST_BY_REPORTER, [reporterId, limit, offset]),
        sql.query<{ total: number }>(tx, COUNT_BY_REPORTER, [reporterId]),
      ]);
      return { items: items.map(toReportRecord), total: count[0]?.total ?? 0 };
    },
    async findByReporter(tx, reporterId, reportId) {
      const row = (await sql.query<ReportRow>(tx, FIND_BY_REPORTER, [reporterId, reportId]))[0];
      return row === undefined ? null : toReportRecord(row);
    },
  };
}

function toReportRecord(row: ReportRow): ReportRecord {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    reviewId: row.review_id,
    category: row.category,
    status: row.status,
    createdAt: row.created_at,
    ...(row.disposition === null ? {} : { disposition: row.disposition }),
  };
}
