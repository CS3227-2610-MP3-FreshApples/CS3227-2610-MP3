import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectAsOwner } from "./schema-fixtures";

// Every entity in spec/data-model.md except the optional WatchlistEntry (D-34), plus node-pg-migrate's
// bookkeeping table, which D-27 places in `app`.
const APP_TABLES = [
  "account",
  "ai_budget_day",
  "ai_budget_reservation",
  "ai_job",
  "announcement",
  "audit_entry",
  "moderation_decision",
  "moderation_strike",
  "moderation_work",
  "movie",
  "pgmigrations",
  "rate_limit_window",
  "report",
  "review",
  "review_moderation",
  "review_summary",
  "scheduler_lease",
  "session",
] as const;

let db: Client;

beforeAll(async () => {
  db = await connectAsOwner();
});

afterAll(async () => {
  await db.end();
});

describe("initial schema objects (D-27, D-34)", () => {
  it("creates exactly the application tables in schema app", async () => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')
       ORDER BY c.relname`,
    );
    expect(rows.map((row) => row.name)).toEqual([...APP_TABLES]);
  });

  it("creates nothing in schema public", async () => {
    const { rows } = await db.query<{ objects: number }>(
      `SELECT
         (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public')
       + (SELECT count(*) FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public')
       + (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public') AS objects`,
    );
    expect(Number(rows[0]?.objects)).toBe(0);
  });

  it("does not create the optional WatchlistEntry table", async () => {
    const { rows } = await db.query(
      `SELECT 1 FROM pg_catalog.pg_class WHERE relname IN ('watchlist_entry', 'watchlist')`,
    );
    expect(rows).toHaveLength(0);
  });

  it("uses no PostgreSQL enum types for closed vocabularies (D-33)", async () => {
    const { rows } = await db.query(
      `SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'app' AND t.typtype = 'e'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("makes every foreign key ON DELETE RESTRICT", async () => {
    const { rows } = await db.query<{ name: string; action: string }>(
      `SELECT con.conname AS name, con.confdeltype AS action FROM pg_catalog.pg_constraint con
       JOIN pg_catalog.pg_namespace n ON n.oid = con.connamespace
       WHERE n.nspname = 'app' AND con.contype = 'f'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.action !== "r")).toEqual([]);
  });

  it("stores every timestamp as timestamptz", async () => {
    const { rows } = await db.query<{ col: string }>(
      `SELECT table_name || '.' || column_name AS col FROM information_schema.columns
       WHERE table_schema = 'app' AND table_name <> 'pgmigrations'
         AND data_type IN ('timestamp without time zone', 'time without time zone', 'time with time zone')`,
    );
    expect(rows).toEqual([]);
  });

  it("creates every index listed in data-model.md", async () => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT indexname AS name FROM pg_catalog.pg_indexes WHERE schemaname = 'app'`,
    );
    const names = rows.map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "account_normalized_email_key",
        "movie_archived_at_title_idx",
        "movie_archived_at_release_date_idx",
        "movie_summary_pending_idx",
        "review_movie_visibility_idx",
        "review_author_id_created_at_idx",
        "moderation_work_status_next_attempt_at_idx",
        "moderation_work_revision_key",
        "report_status_created_at_idx",
        "report_target_user_id_created_at_idx",
        "report_reporter_id_created_at_idx",
        "report_open_reporter_id_review_id_key",
        "moderation_strike_target_user_id_strike_cycle_idx",
        "moderation_strike_target_user_id_review_id_key",
        "announcement_state_published_at_idx",
        "ai_job_status_lease_until_idx",
        "ai_job_running_dedup_key_key",
        "audit_entry_target_created_at_idx",
        "rate_limit_window_window_start_idx",
        "ai_budget_reservation_budget_day_status_idx",
      ]),
    );
  });
});
