import "server-only";

import type { Sql, SqlParam } from "../../db";
import type { ModerationState, ReviewId, RowVersion, Tx } from "../../shared";
import type { AdminReviewFilters } from "../../services/moderation/admin-review-input";
import type { ModerationOutput } from "../../services/ai/moderation/output-schema";

export interface AdminReviewAssessment {
  readonly contentRevision: number;
  readonly capturedReviewVersion: number;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly policyVersion: string;
  readonly generatedAt: string;
  readonly result: ModerationOutput;
}
export interface AdminReview {
  readonly id: ReviewId;
  readonly movieId: string;
  readonly authorId: string;
  readonly authorDisplayName: string;
  readonly movieTitle: string;
  readonly rating: number;
  readonly body: string;
  readonly version: RowVersion;
  readonly contentRevision: number;
  readonly moderationState: ModerationState;
  readonly hidden: boolean;
  readonly deleted: boolean;
  readonly movieArchived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly latestAssessment: AdminReviewAssessment | null;
}
export interface AdminReviewQueryRepository {
  list(tx: Tx, filters: AdminReviewFilters, limit: number, offset: number): Promise<readonly AdminReview[]>;
  count(tx: Tx, filters: AdminReviewFilters): Promise<number>;
  get(tx: Tx, reviewId: ReviewId): Promise<AdminReview | null>;
}

// O-23: cross-module SELECTs belong to the consuming Moderation feature; no writes or lock clauses here.
const FROM = `
  FROM app.review r JOIN app.movie m ON m.id = r.movie_id
  JOIN app.account author ON author.id = r.author_id
  LEFT JOIN LATERAL (
    SELECT content_revision, captured_review_version, model_id, prompt_version, policy_version,
           generated_at, output_json
    FROM app.review_moderation WHERE review_id = r.id
    ORDER BY generated_at DESC, id ASC LIMIT 1
  ) assessment ON true`;
const SELECT = `
  SELECT r.id, r.movie_id, r.author_id, author.display_name AS author_display_name, m.title AS movie_title,
         r.rating, r.body, r.version, r.content_revision,
         r.moderation_state, r.hidden_at IS NOT NULL AS hidden, r.deleted_at IS NOT NULL AS deleted,
         m.archived_at IS NOT NULL AS movie_archived, r.created_at, r.updated_at,
         assessment.content_revision AS assessed_revision, assessment.captured_review_version,
         assessment.model_id, assessment.prompt_version, assessment.policy_version,
         assessment.generated_at, assessment.output_json ${FROM}`;

function predicate(filters: AdminReviewFilters): { text: string; params: SqlParam[] } {
  const params: SqlParam[] = [filters.movieId];
  const movie = "($1::uuid IS NULL OR r.movie_id = $1)";
  let condition: string;
  switch (filters.assessment) {
    case "all": condition = "true"; break;
    case "hidden": condition = "r.hidden_at IS NOT NULL"; break;
    case "deleted": condition = "r.deleted_at IS NOT NULL"; break;
    case "pending": case "flagged": case "cleared":
      params.push(filters.assessment);
      condition = "r.moderation_state = $2";
      break;
    case "needs_manual_review":
      condition = `EXISTS (SELECT 1 FROM app.moderation_work w WHERE w.review_id = r.id
        AND w.content_revision = r.content_revision AND w.status = 'needs_manual_review')`;
      break;
    case "failed":
      condition = `r.moderation_state = 'pending' AND EXISTS (SELECT 1 FROM app.moderation_work w
        WHERE w.review_id = r.id AND w.content_revision = r.content_revision
          AND w.status IN ('pending', 'needs_manual_review') AND w.execution_count > 0)`;
      break;
    default:
      params.push(filters.assessment);
      condition = "assessment.content_revision = r.content_revision AND assessment.output_json ->> 'assessment' = $2";
  }
  return { text: `WHERE ${movie} AND (${condition})`, params };
}

interface ReviewRow {
  author_display_name: string; movie_title: string;
  id: ReviewId; movie_id: string; author_id: string; rating: number; body: string; version: RowVersion;
  content_revision: number; moderation_state: ModerationState; hidden: boolean; deleted: boolean;
  movie_archived: boolean; created_at: Date; updated_at: Date; assessed_revision: number | null;
  captured_review_version: number; model_id: string; prompt_version: string; policy_version: string;
  generated_at: Date; output_json: ModerationOutput;
}
function project(row: ReviewRow): AdminReview {
  return {
    id: row.id, movieId: row.movie_id, authorId: row.author_id, rating: row.rating, body: row.body,
    authorDisplayName: row.author_display_name, movieTitle: row.movie_title,
    version: row.version, contentRevision: row.content_revision, moderationState: row.moderation_state,
    hidden: row.hidden, deleted: row.deleted, movieArchived: row.movie_archived,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    latestAssessment: row.assessed_revision === null ? null : {
      contentRevision: row.assessed_revision, capturedReviewVersion: row.captured_review_version,
      modelId: row.model_id, promptVersion: row.prompt_version, policyVersion: row.policy_version,
      generatedAt: row.generated_at.toISOString(),
      result: {
        assessment: row.output_json.assessment, explanation: row.output_json.explanation,
        matches: row.output_json.matches.map(({ quote, reason }) => ({ quote, reason })),
        limitations: row.output_json.limitations,
      },
    },
  };
}
export function createAdminReviewQueryRepository({ sql }: { readonly sql: Sql }): AdminReviewQueryRepository {
  return {
    async list(tx, filters, limit, offset) {
      const where = predicate(filters);
      const count = where.params.length;
      const rows = await sql.query<ReviewRow>(tx,
        `${SELECT} ${where.text} ORDER BY r.updated_at DESC, r.id ASC LIMIT $${count + 1} OFFSET $${count + 2}`,
        [...where.params, limit, offset]);
      return rows.map(project);
    },
    async count(tx, filters) {
      const where = predicate(filters);
      const rows = await sql.query<{ total: number }>(tx, `SELECT count(*)::integer AS total ${FROM} ${where.text}`, where.params);
      return rows[0]!.total;
    },
    async get(tx, reviewId) {
      const rows = await sql.query<ReviewRow>(tx, `${SELECT} WHERE r.id = $1`, [reviewId]);
      return rows[0] === undefined ? null : project(rows[0]);
    },
  };
}
