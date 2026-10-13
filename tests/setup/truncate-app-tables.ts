import { Client } from "pg";
import { beforeAll, inject } from "vitest";

// Every application table in schema `app` except node-pg-migrate's bookkeeping (D-27), quoted for SQL.
const APP_TABLES = `
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') AS tables
  FROM pg_catalog.pg_tables
  WHERE schemaname = 'app' AND tablename <> 'pgmigrations'`;

/**
 * Runs before each integration test file: empties the application tables so files start from a clean,
 * migrated schema. Data is committed, not rolled back per test, so concurrency tests see it (D-10).
 */
beforeAll(async () => {
  const client = new Client({ connectionString: inject("testDatabaseUrl"), ssl: false });
  await client.connect();
  try {
    const { rows } = await client.query<{ tables: string | null }>(APP_TABLES);
    const tables = rows[0]?.tables;
    if (tables) {
      await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
});
