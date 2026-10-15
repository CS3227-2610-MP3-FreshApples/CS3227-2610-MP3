// Operator release step (DEP-03): applies pending migrations over MIGRATION_DATABASE_URL.
// Take the pre-migration backup first. Never prints the connection string.
import { migrateUp } from "../src/server/db/migrate.mjs";

const NO_TLS_APP_ENVS = new Set(["local", "test"]);

function targetFromEnv(env) {
  const url = env.MIGRATION_DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("MIGRATION_DATABASE_URL must be set");
  }
  const caCert = env.DATABASE_CA_CERT === undefined || env.DATABASE_CA_CERT === "" ? null : env.DATABASE_CA_CERT;
  if (caCert === null && !NO_TLS_APP_ENVS.has(env.APP_ENV)) {
    throw new Error("DATABASE_CA_CERT is required unless APP_ENV is local or test (D-30)");
  }
  return { url, caCert };
}

try {
  await migrateUp(targetFromEnv(process.env), (message) => console.log(message));
} catch (error) {
  console.error(`db:migrate failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
