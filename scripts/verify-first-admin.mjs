// Controlled D-83 operator check. Reads migration credentials only from the
// environment and prints an aggregate count, never account or connection data.
import { pathToFileURL } from "node:url";

import { Client } from "pg";

const NO_TLS_APP_ENVS = new Set(["local", "test"]);
const BEGIN_READ_ONLY = "BEGIN READ ONLY";
const STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '5s'";
const COUNT_ADMINS = "SELECT count(*)::int AS admin_count FROM app.account WHERE role = 'ADMIN'";

function targetFromEnv(env) {
  const connectionString = env.MIGRATION_DATABASE_URL;
  if (connectionString === undefined || connectionString === "") throw new Error("invalid operator configuration");

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("invalid operator configuration");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("invalid operator configuration");
  if ([...parsed.searchParams.keys()].some((key) => key.toLowerCase().startsWith("ssl"))) {
    throw new Error("invalid operator configuration");
  }

  const caCert = env.DATABASE_CA_CERT === undefined || env.DATABASE_CA_CERT === "" ? null : env.DATABASE_CA_CERT;
  if (caCert === null && !NO_TLS_APP_ENVS.has(env.APP_ENV)) throw new Error("invalid operator configuration");

  return {
    connectionString,
    ssl: caCert === null ? false : { ca: caCert, rejectUnauthorized: true },
  };
}

/**
 * Returns a process exit code. Dependencies are injected so tests can observe
 * the operator-visible contract without opening a database connection.
 */
export async function runFirstAdminVerification({ env, createClient, writeOutput, writeError }) {
  let client;
  let transactionOpen = false;
  let adminCount;
  let failed = false;

  try {
    client = createClient(targetFromEnv(env));
    await client.connect();
    await client.query(BEGIN_READ_ONLY);
    transactionOpen = true;
    await client.query(STATEMENT_TIMEOUT);
    const result = await client.query(COUNT_ADMINS);
    const count = result.rows[0]?.admin_count;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid verification result");
    adminCount = count;
    await client.query("COMMIT");
    transactionOpen = false;
  } catch {
    failed = true;
    if (client !== undefined && transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The fixed public failure below deliberately hides driver details.
      }
    }
  } finally {
    if (client !== undefined) {
      try {
        await client.end();
      } catch {
        failed = true;
      }
    }
  }

  if (failed || adminCount === undefined) {
    writeError("db:verify-first-admin failed");
    return 1;
  }
  writeOutput(`admin_count=${adminCount}`);
  return adminCount === 1 ? 0 : 1;
}

async function main() {
  if (process.argv.length !== 2) {
    console.error("db:verify-first-admin failed");
    process.exitCode = 1;
    return;
  }
  process.exitCode = await runFirstAdminVerification({
    env: process.env,
    createClient: (config) => new Client(config),
    writeOutput: (line) => console.log(line),
    writeError: (line) => console.error(line),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
