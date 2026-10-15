// Migration runner (D-08, D-26, D-27). Plain JavaScript so the operator step and the test harness run it
// under Node.js without a TypeScript loader. Never imported by application code.
import { fileURLToPath } from "node:url";

import { runner } from "node-pg-migrate";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));
const APP_SCHEMA = "app";
const MIGRATIONS_TABLE = "pgmigrations";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * @typedef {object} MigrationTarget
 * @property {string} url Direct or session-mode connection URL, with no ssl* query parameter.
 * @property {string | null} caCert PEM CA certificate; `null` only for a loopback host (D-30).
 */

/**
 * CA-verified TLS, or no TLS to a loopback host (D-30). Errors never include the URL.
 * @param {MigrationTarget} target
 * @returns {import("pg").ClientConfig}
 */
function clientConfig(target) {
  let url;
  try {
    url = new URL(target.url);
  } catch {
    throw new Error("migration database URL is not a valid URL");
  }
  if ([...url.searchParams.keys()].some((key) => key.toLowerCase().startsWith("ssl"))) {
    throw new Error("migration database URL must not contain ssl* parameters; they override the driver's TLS options");
  }
  if (target.caCert === null && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("a migration database without DATABASE_CA_CERT must use a loopback host (D-30)");
  }
  return {
    connectionString: target.url,
    ssl: target.caCert === null ? false : { ca: target.caCert, rejectUnauthorized: true },
  };
}

/**
 * Applies every pending migration in `src/server/db/migrations/` to schema `app`, creating the schema if
 * needed and keeping node-pg-migrate's bookkeeping table in `app` (D-27). All pending files run in one
 * transaction.
 * @param {MigrationTarget} target
 * @param {(message: string) => void} log
 * @returns {Promise<void>}
 */
export async function migrateUp(target, log) {
  await runner({
    databaseUrl: clientConfig(target),
    dir: MIGRATIONS_DIR,
    schema: APP_SCHEMA,
    createSchema: true,
    migrationsSchema: APP_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
    direction: "up",
    checkOrder: true,
    singleTransaction: true,
    log,
  });
}
