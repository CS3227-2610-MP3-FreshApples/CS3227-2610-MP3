import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { expect } from "vitest";

import { testDatabaseUrl } from "./test-database";

/**
 * A direct connection as the test server's superuser, for schema tests that bypass the application layer.
 * Tests that need a narrower role use `SET ROLE` on their own connection.
 */
export async function connectAsOwner(): Promise<Client> {
  const client = new Client({ connectionString: testDatabaseUrl(), ssl: false });
  await client.connect();
  return client;
}

/** Asserts a statement fails with this SQLSTATE and, when given, this constraint or index name. */
export async function expectViolation(
  statement: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  await expect(statement).rejects.toMatchObject(constraint === undefined ? { code } : { code, constraint });
}

async function insertReturningId(db: Client, text: string, params: readonly unknown[]): Promise<string> {
  const { rows } = await db.query<{ id: string }>(text, [...params]);
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("insert returned no id");
  }
  return id;
}

// Synthetic fixtures only: no real emails, names or password hashes.

export function insertAccount(db: Client, role: "USER" | "ADMIN" = "USER"): Promise<string> {
  return insertReturningId(
    db,
    `INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
     VALUES ($1, 'synthetic-hash', 'Synthetic Account', $2, 'active') RETURNING id`,
    [`${randomUUID()}@example.test`, role],
  );
}

export function insertMovie(db: Client): Promise<string> {
  return insertReturningId(
    db,
    `INSERT INTO app.movie (title, synopsis, director) VALUES ('Synthetic Movie', 'Synthetic synopsis.', '')
     RETURNING id`,
    [],
  );
}

export function insertReview(db: Client, movieId: string, authorId: string): Promise<string> {
  return insertReturningId(
    db,
    `INSERT INTO app.review (movie_id, author_id, rating, body, moderation_state)
     VALUES ($1, $2, 7, 'Synthetic review body.', 'pending') RETURNING id`,
    [movieId, authorId],
  );
}

export interface ReportFixture {
  readonly reporterId: string;
  readonly targetUserId: string;
  readonly reviewId: string;
  readonly status: "open" | "dismissed" | "accepted";
}

export function insertReport(db: Client, report: ReportFixture): Promise<string> {
  return insertReturningId(
    db,
    `INSERT INTO app.report (reporter_id, target_user_id, review_id, category, explanation, evidence_snapshot, status)
     VALUES ($1, $2, $3, 'spam', 'Synthetic explanation.', '{}'::jsonb, $4) RETURNING id`,
    [report.reporterId, report.targetUserId, report.reviewId, report.status],
  );
}

export function insertAiJob(
  db: Client,
  job: { readonly dedupKey: string; readonly status: "running" | "succeeded" | "failed" | "stale" },
): Promise<string> {
  return insertReturningId(
    db,
    `INSERT INTO app.ai_job (type, trigger, subject_id, input_revision, dedup_key, status, lease_until, expires_at,
                             model_id, prompt_version, input_hash)
     VALUES ('summary', 'scheduler', $1, 0, $2, $3, now() + interval '90 seconds', now() + interval '7 days',
             'synthetic-model', 'p1', 'synthetic-hash')
     RETURNING id`,
    [randomUUID(), job.dedupKey, job.status],
  );
}

/** A UTC budget day not used by any other fixture in the same file. */
export function uniqueBudgetDay(offsetDays: number): string {
  const day = new Date(Date.UTC(2026, 0, 1) + offsetDays * 86_400_000);
  return day.toISOString().slice(0, 10);
}
