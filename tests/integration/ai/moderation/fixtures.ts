import type { Client } from "pg";

import {
  PROFANITY_POLICY_VERSION,
  REVIEW_SCREENING_PROMPT_VERSION,
} from "../../../../src/server/services/ai/moderation";
import type { ReviewId } from "../../../../src/server/shared";

// Synthetic Review and ModerationWork rows for the A-03 PostgreSQL tests, written as the owner. They stand in for
// what U-02 review writes and K9 enqueue commit; they are not evidence for those writes.

export interface ReviewSeed {
  readonly body?: string;
  readonly state?: "pending" | "flagged" | "cleared";
  readonly hidden?: boolean;
  readonly deleted?: boolean;
  readonly contentRevision?: number;
  readonly archivedMovie?: boolean;
}

export interface SeededReview {
  readonly reviewId: ReviewId;
  readonly authorId: string;
  readonly movieId: string;
}

export const SYNTHETIC_BODY = "The plot drags, and the lead is a sh1tty actor. Lovely score though.";

/** One Review on its own Movie, by a new synthetic author. */
export async function seedReview(owner: Client, seed: ReviewSeed = {}): Promise<SeededReview> {
  const movie = await owner.query<{ id: string }>(
    `INSERT INTO app.movie (title, synopsis, director, archived_at)
     VALUES ('Synthetic Movie', 'Synthetic synopsis.', '', $1) RETURNING id`,
    [seed.archivedMovie === true ? new Date() : null],
  );
  const author = await owner.query<{ id: string }>(
    `INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
     VALUES (gen_random_uuid() || '@example.test', 'synthetic-hash', 'Synthetic', 'USER', 'active') RETURNING id`,
  );
  const review = await owner.query<{ id: ReviewId }>(
    `INSERT INTO app.review (movie_id, author_id, rating, body, moderation_state, content_revision, hidden_at, deleted_at)
     VALUES ($1, $2, 7, $3, $4, $5, $6, $7) RETURNING id`,
    [
      movie.rows[0]!.id,
      author.rows[0]!.id,
      seed.body ?? SYNTHETIC_BODY,
      seed.state ?? "pending",
      seed.contentRevision ?? 1,
      seed.hidden === true ? new Date() : null,
      seed.deleted === true ? new Date() : null,
    ],
  );
  return { reviewId: review.rows[0]!.id, authorId: author.rows[0]!.id, movieId: movie.rows[0]!.id };
}

export interface WorkSeed {
  readonly contentRevision?: number;
  readonly status?: string;
  readonly executionCount?: number;
  readonly promptVersion?: string;
  readonly policyVersion?: string;
  /** Seconds from now; negative is in the past. */
  readonly nextAttemptInSeconds?: number;
  /** Seconds from now, or null for never attempted. */
  readonly lastAttemptInSeconds?: number | null;
}

/** One ModerationWork row, current versions and `pending` by default. */
export async function seedWork(owner: Client, reviewId: ReviewId, seed: WorkSeed = {}): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app.moderation_work (review_id, content_revision, prompt_version, policy_version, status,
                                      execution_count, next_attempt_at, last_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7),
             CASE WHEN $8::double precision IS NULL THEN NULL ELSE now() + make_interval(secs => $8) END)
     RETURNING id`,
    [
      reviewId,
      seed.contentRevision ?? 1,
      seed.promptVersion ?? REVIEW_SCREENING_PROMPT_VERSION,
      seed.policyVersion ?? PROFANITY_POLICY_VERSION,
      seed.status ?? "pending",
      seed.executionCount ?? 0,
      seed.nextAttemptInSeconds ?? 0,
      seed.lastAttemptInSeconds ?? null,
    ],
  );
  return rows[0]!.id;
}

export interface WorkRow {
  readonly id: string;
  readonly content_revision: number;
  readonly model_id: string | null;
  readonly prompt_version: string;
  readonly policy_version: string;
  readonly status: string;
  readonly execution_count: number;
  readonly last_attempt_at: Date | null;
  readonly next_attempt_at: Date;
  /** `next_attempt_at` minus now, in whole seconds. */
  readonly next_in_seconds: number;
}

export async function workRows(owner: Client, reviewId: ReviewId): Promise<WorkRow[]> {
  const { rows } = await owner.query<WorkRow>(
    `SELECT id, content_revision, model_id, prompt_version, policy_version, status, execution_count, last_attempt_at,
            next_attempt_at, round(extract(epoch FROM next_attempt_at - now()))::integer AS next_in_seconds
     FROM app.moderation_work WHERE review_id = $1 ORDER BY created_at, id`,
    [reviewId],
  );
  return rows;
}
