// Disposable test database shared by the integration harness and the e2e wrapper (D-10, D-31, D-42).
// Plain JavaScript so the e2e wrapper runs it under Node.js without a TypeScript loader.
import { randomBytes } from "node:crypto";

import pg from "pg";

import { migrateUp } from "../../src/server/db/migrate.mjs";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Created by an operator on Supabase; synthetic NOLOGIN stand-ins here, so migrations run unchanged (D-31). */
const SYNTHETIC_ROLES = ["app_runtime", "anon", "authenticated"];

/**
 * The disposable PostgreSQL 17 server named by `TEST_DATABASE_URL` (D-10). Refuses anything but a loopback
 * host, so a test run can never reach the shared Supabase projects (D-30).
 * @returns {URL}
 */
export function testServerUrl() {
  const raw = process.env.TEST_DATABASE_URL;
  if (raw === undefined || raw === "") {
    throw new Error("TEST_DATABASE_URL must be set to a disposable local PostgreSQL (D-10)");
  }
  let url;
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

/**
 * @template T
 * @param {URL} serverUrl
 * @param {(client: pg.Client) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withServer(serverUrl, work) {
  const client = new pg.Client({ connectionString: serverUrl.href, ssl: false });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** @param {pg.Client} client */
async function createSyntheticRoles(client) {
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
 * @typedef {object} ThrowawayDatabase
 * @property {string} url Superuser URL of the migrated database.
 * @property {() => Promise<void>} drop Drops the database, ending any open connections to it.
 */

/**
 * Creates the synthetic D-31 roles and a uniquely named database on the local server, and applies every
 * migration to it. The database is dropped again if migrating fails.
 * @param {URL} serverUrl
 * @param {string} namePrefix
 * @returns {Promise<ThrowawayDatabase>}
 */
export async function createMigratedDatabase(serverUrl, namePrefix) {
  const databaseName = `${namePrefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const databaseUrl = new URL(serverUrl.href);
  databaseUrl.pathname = `/${databaseName}`;

  const drop = async () => {
    await withServer(serverUrl, (client) => client.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`));
  };

  await withServer(serverUrl, async (client) => {
    await createSyntheticRoles(client);
    await client.query(`CREATE DATABASE ${databaseName}`);
  });
  try {
    await migrateUp({ url: databaseUrl.href, caCert: null }, () => undefined);
  } catch (error) {
    await drop();
    throw error;
  }
  return { url: databaseUrl.href, drop };
}

/**
 * The per-run e2e login role (D-31, D-42): a member of `app_runtime` with INHERIT, so it holds exactly
 * `app_runtime`'s privileges. `app_runtime` itself never gets LOGIN or a password.
 * @param {pg.Client} client
 * @param {string} roleName a generated identifier of lowercase letters, digits and underscores
 * @param {string} password
 * @returns {Promise<void>}
 */
export async function createLoginRole(client, roleName, password) {
  await client.query(`CREATE ROLE ${roleName} LOGIN INHERIT PASSWORD ${client.escapeLiteral(password)}`);
  await client.query(`GRANT app_runtime TO ${roleName} WITH INHERIT TRUE`);
}

/**
 * @param {pg.Client} client
 * @param {string} roleName
 * @returns {Promise<void>}
 */
export async function dropLoginRole(client, roleName) {
  await client.query(`DROP ROLE IF EXISTS ${roleName}`);
}
