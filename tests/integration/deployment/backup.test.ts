import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runBackup } from "../../../scripts/db-backup.mjs";
import { runRestore } from "../../../scripts/db-restore.mjs";
import { RESTORE_CONFIRMATION } from "../../../scripts/lib/backup-common.mjs";

const PASSPHRASE = "synthetic-integration-backup-passphrase-32-plus";
let directory: string;
let serverUrl: URL;
const createdDatabases: string[] = [];

async function ownerClient(url: string | URL) {
  const client = new pg.Client({ connectionString: String(url), ssl: false });
  await client.connect();
  return client;
}

async function createEmptyDatabase() {
  const name = `mp3_restore_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const client = await ownerClient(serverUrl);
  try { await client.query(`CREATE DATABASE ${name}`); } finally { await client.end(); }
  createdDatabases.push(name);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.href;
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "mp3-backup-integration-"));
  serverUrl = new URL(inject("testDatabaseUrl"));
  serverUrl.pathname = "/postgres";
});

afterAll(async () => {
  const client = await ownerClient(serverUrl);
  try {
    for (const name of createdDatabases) await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await client.end();
    await rm(directory, { recursive: true, force: true });
  }
});

function backupEnv(outputPath: string) {
  return {
    ...process.env,
    APP_ENV: "test",
    MIGRATION_DATABASE_URL: inject("testDatabaseUrl"),
    DATABASE_CA_CERT: "",
    BACKUP_ENCRYPTION_PASSPHRASE: PASSPHRASE,
    BACKUP_OUTPUT_PATH: outputPath,
  };
}

function restoreEnv(inputPath: string, databaseUrl: string) {
  return {
    ...process.env,
    APP_ENV: "test",
    MIGRATION_DATABASE_URL: databaseUrl,
    DATABASE_CA_CERT: "",
    BACKUP_ENCRYPTION_PASSPHRASE: PASSPHRASE,
    BACKUP_INPUT_PATH: inputPath,
    RESTORE_CONFIRM_EMPTY_DATABASE: RESTORE_CONFIRMATION,
  };
}

describe("encrypted app-schema backup and restore (DEP-03, DEP-08)", { timeout: 30_000 }, () => {
  it("round-trips migration bookkeeping, data and runtime ACLs through the real PostgreSQL tools", async () => {
    const source = await ownerClient(inject("testDatabaseUrl"));
    try {
      await source.query(`INSERT INTO app.movie (title, synopsis, release_date, director, "cast")
        VALUES ('Synthetic Backup Movie', 'Synthetic restore evidence.', '2026-01-01', 'Synthetic Director', ARRAY['Test Actor'])`);
    } finally { await source.end(); }

    const backupPath = path.join(directory, "roundtrip.backup.enc");
    expect(await runBackup({ env: backupEnv(backupPath), repositoryRoot: process.cwd(), writeOutput: () => undefined, writeError: () => undefined })).toBe(0);
    const restoreUrl = await createEmptyDatabase();
    await runRestore({ env: restoreEnv(backupPath, restoreUrl), repositoryRoot: process.cwd() });

    const restored = await ownerClient(restoreUrl);
    try {
      const movie = await restored.query("SELECT title FROM app.movie");
      const migrations = await restored.query("SELECT count(*)::int AS count FROM app.pgmigrations");
      const privilege = await restored.query("SELECT has_table_privilege('app_runtime', 'app.movie', 'SELECT') AS granted");
      expect(movie.rows).toEqual([{ title: "Synthetic Backup Movie" }]);
      expect(migrations.rows[0]?.count).toBeGreaterThan(0);
      expect(privilege.rows).toEqual([{ granted: true }]);
    } finally { await restored.end(); }
  });

  it("authenticates the entire encrypted snapshot before creating the app schema", async () => {
    const backupPath = path.join(directory, "valid.backup.enc");
    expect(await runBackup({ env: backupEnv(backupPath), repositoryRoot: process.cwd(), writeOutput: () => undefined, writeError: () => undefined })).toBe(0);
    const tamperedPath = path.join(directory, "tampered.backup.enc");
    const tampered = await readFile(backupPath);
    tampered[Math.floor(tampered.length / 2)] ^= 1;
    await writeFile(tamperedPath, tampered, { flag: "wx", mode: 0o600 });
    const restoreUrl = await createEmptyDatabase();

    await expect(runRestore({ env: restoreEnv(tamperedPath, restoreUrl), repositoryRoot: process.cwd() })).rejects.toThrow();
    const target = await ownerClient(restoreUrl);
    try {
      const schema = await target.query("SELECT to_regnamespace('app') AS app_schema");
      expect(schema.rows).toEqual([{ app_schema: null }]);
    } finally { await target.end(); }
  });

  it("refuses a non-empty target before invoking pg_restore", async () => {
    const backupPath = path.join(directory, "refusal.backup.enc");
    expect(await runBackup({ env: backupEnv(backupPath), repositoryRoot: process.cwd(), writeOutput: () => undefined, writeError: () => undefined })).toBe(0);
    const restoreUrl = await createEmptyDatabase();
    const target = await ownerClient(restoreUrl);
    try { await target.query("CREATE TABLE public.existing_data (id integer)"); } finally { await target.end(); }

    await expect(runRestore({ env: restoreEnv(backupPath, restoreUrl), repositoryRoot: process.cwd() })).rejects.toThrow("not empty");
  });
});
