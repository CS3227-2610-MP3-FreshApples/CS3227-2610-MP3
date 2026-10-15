import { randomBytes } from "node:crypto";

import { Client } from "pg";
import type { TestProject } from "vitest/node";

import { migrateUp } from "../../src/server/db/migrate.mjs";

declare module "vitest" {
  export interface ProvidedContext {
    /** URL of this run's throwaway, fully migrated database. */
    testDatabaseUrl: string;
  }
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Created by an operator on Supabase; synthetic NOLOGIN stand-ins here, so migrations run unchanged (D-31). */
const SYNTHETIC_ROLES = ["app_runtime", "anon", "authenticated"] as const;

/**
 * The disposable PostgreSQL 17 server named by `TEST_DATABASE_URL` (D-10). Refuses anything but a loopback
 * host, so a test run can never reach the shared Supabase projects (D-30).
 */
function testServerUrl(): URL {
  const raw = process.env.TEST_DATABASE_URL;
  if (raw === undefined || raw === "") {
    throw new Error("TEST_DATABASE_URL must be set to a disposable local PostgreSQL (D-10)");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("TEST_DATABASE_URL must use a loopback host");
  }
  return url;
}

async function withServer<T>(serverUrl: URL, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: serverUrl.href, ssl: false });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function createSyntheticRoles(client: Client): Promise<void> {
  for (const role of SYNTHETIC_ROLES) {
    // Roles are cluster-wide and outlive the throwaway database; a concurrent run may create one first.
    await client.query(`
      DO $$ BEGIN
        CREATE ROLE ${role} NOLOGIN;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
  }
}

/**
 * Integration global setup (D-10): creates a uniquely named database on the local server, applies every
 * migration to it, and drops it when the run ends.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const serverUrl = testServerUrl();
  const databaseName = `mp3_test_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const databaseUrl = new URL(serverUrl.href);
  databaseUrl.pathname = `/${databaseName}`;

  const dropDatabase = () =>
    withServer(serverUrl, (client) => client.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`));

  await withServer(serverUrl, async (client) => {
    await createSyntheticRoles(client);
    await client.query(`CREATE DATABASE ${databaseName}`);
  });
  try {
    await migrateUp({ url: databaseUrl.href, caCert: null }, () => undefined);
  } catch (error) {
    await dropDatabase();
    throw error;
  }

  project.provide("testDatabaseUrl", databaseUrl.href);
  return async () => {
    await dropDatabase();
  };
}
