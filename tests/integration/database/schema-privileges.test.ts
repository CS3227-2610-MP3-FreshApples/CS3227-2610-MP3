import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { connectAsOwner, expectViolation } from "./schema-fixtures";

const INSUFFICIENT_PRIVILEGE = "42501";
const TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;
type TablePrivilege = (typeof TABLE_PRIVILEGES)[number];

const SELECT_INSERT_UPDATE: readonly TablePrivilege[] = ["SELECT", "INSERT", "UPDATE"];
const SELECT_INSERT: readonly TablePrivilege[] = ["SELECT", "INSERT"];

// data-model.md "Runtime privileges" (D-32), exactly. pgmigrations is node-pg-migrate's bookkeeping (D-27).
const RUNTIME_PRIVILEGES: Readonly<Record<string, readonly TablePrivilege[]>> = {
  account: SELECT_INSERT_UPDATE,
  movie: SELECT_INSERT_UPDATE,
  review: SELECT_INSERT_UPDATE,
  report: SELECT_INSERT_UPDATE,
  announcement: SELECT_INSERT_UPDATE,
  ai_job: SELECT_INSERT_UPDATE,
  moderation_work: SELECT_INSERT_UPDATE,
  scheduler_lease: SELECT_INSERT_UPDATE,
  ai_budget_day: SELECT_INSERT_UPDATE,
  ai_budget_reservation: SELECT_INSERT_UPDATE,
  session: ["SELECT", "INSERT", "DELETE"],
  rate_limit_window: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  moderation_decision: SELECT_INSERT,
  review_summary: SELECT_INSERT,
  review_moderation: SELECT_INSERT,
  moderation_strike: SELECT_INSERT,
  audit_entry: SELECT_INSERT,
  pgmigrations: [],
};
const API_ROLES = ["anon", "authenticated", "public"] as const;

let db: Client;

beforeAll(async () => {
  db = await connectAsOwner();
});

afterEach(async () => {
  await db.query("RESET ROLE");
});

afterAll(async () => {
  await db.end();
});

async function hasTablePrivilege(role: string, table: string, privilege: TablePrivilege): Promise<boolean> {
  const { rows } = await db.query<{ granted: boolean }>(
    "SELECT has_table_privilege($1, format('app.%I', $2::text), $3) AS granted",
    [role, table, privilege],
  );
  return rows[0]?.granted === true;
}

async function hasSchemaPrivilege(role: string, privilege: "USAGE" | "CREATE"): Promise<boolean> {
  const { rows } = await db.query<{ granted: boolean }>(
    "SELECT has_schema_privilege($1, 'app', $2) AS granted",
    [role, privilege],
  );
  return rows[0]?.granted === true;
}

describe("app_runtime privileges (D-27, D-32)", () => {
  it.each(Object.entries(RUNTIME_PRIVILEGES))("has exactly the listed privileges on app.%s", async (table, granted) => {
    const actual: TablePrivilege[] = [];
    for (const privilege of TABLE_PRIVILEGES) {
      if (await hasTablePrivilege("app_runtime", table, privilege)) {
        actual.push(privilege);
      }
    }
    expect(actual).toEqual(TABLE_PRIVILEGES.filter((privilege) => granted.includes(privilege)));
  });

  it("covers every table in schema app", async () => {
    const { rows } = await db.query<{ name: string }>(
      "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = 'app' ORDER BY tablename",
    );
    expect(rows.map((row) => row.name)).toEqual(Object.keys(RUNTIME_PRIVILEGES).sort());
  });

  it("has USAGE but not CREATE on schema app", async () => {
    expect(await hasSchemaPrivilege("app_runtime", "USAGE")).toBe(true);
    expect(await hasSchemaPrivilege("app_runtime", "CREATE")).toBe(false);
  });

  it("can insert an AuditEntry but cannot update or delete one", async () => {
    await db.query("SET ROLE app_runtime");
    await db.query(
      `INSERT INTO app.audit_entry (action, target_type, target_id, result, request_id)
       VALUES ('movie.create', 'movie', gen_random_uuid(), 'applied', 'synthetic-request')`,
    );
    await expectViolation(db.query("UPDATE app.audit_entry SET result = 'no_op'"), INSUFFICIENT_PRIVILEGE);
    await expectViolation(db.query("DELETE FROM app.audit_entry"), INSUFFICIENT_PRIVILEGE);
  });

  it("cannot read the migration bookkeeping table", async () => {
    await db.query("SET ROLE app_runtime");
    await expectViolation(db.query("SELECT * FROM app.pgmigrations"), INSUFFICIENT_PRIVILEGE);
  });

  it("cannot run DDL in schema app", async () => {
    await db.query("SET ROLE app_runtime");
    await expectViolation(db.query("CREATE TABLE app.runtime_probe (id integer)"), INSUFFICIENT_PRIVILEGE);
    await expectViolation(db.query("ALTER TABLE app.account ADD COLUMN probe integer"), INSUFFICIENT_PRIVILEGE);
    await expectViolation(db.query("TRUNCATE app.rate_limit_window"), INSUFFICIENT_PRIVILEGE);
  });
});

describe("API roles have no access to schema app (security.md, D-27)", () => {
  it.each(API_ROLES)("%s has no privilege on schema app", async (role) => {
    expect(await hasSchemaPrivilege(role, "USAGE")).toBe(false);
    expect(await hasSchemaPrivilege(role, "CREATE")).toBe(false);
  });

  it.each(API_ROLES)("%s has no privilege on any table in app", async (role) => {
    const granted: string[] = [];
    for (const table of Object.keys(RUNTIME_PRIVILEGES)) {
      for (const privilege of TABLE_PRIVILEGES) {
        if (await hasTablePrivilege(role, table, privilege)) {
          granted.push(`${table}:${privilege}`);
        }
      }
    }
    expect(granted).toEqual([]);
  });

  it.each(["anon", "authenticated"])("%s cannot select from app tables", async (role) => {
    await db.query(`SET ROLE ${role}`);
    await expectViolation(db.query("SELECT * FROM app.account"), INSUFFICIENT_PRIVILEGE);
    await expectViolation(db.query("SELECT * FROM app.review"), INSUFFICIENT_PRIVILEGE);
  });
});
