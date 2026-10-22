import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const REQUIRED_DATABASE_ROLES = ["app_runtime", "anon", "authenticated"];
export const RESTORE_CONFIRMATION = "I_CONFIRM_THIS_DISPOSABLE_DATABASE_IS_EMPTY";

export function requiredEnv(env, name) {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} must be set`);
  return value;
}

export function parseOperatorTarget(env, { restore = false } = {}) {
  const raw = requiredEnv(env, "MIGRATION_DATABASE_URL");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MIGRATION_DATABASE_URL is not a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("MIGRATION_DATABASE_URL must use postgres or postgresql");
  }
  if (url.search !== "") throw new Error("MIGRATION_DATABASE_URL must not contain query parameters");
  if (url.username === "" || url.hostname === "" || url.pathname.length < 2) {
    throw new Error("MIGRATION_DATABASE_URL must include a user, host and database");
  }

  const caCert = env.DATABASE_CA_CERT === undefined || env.DATABASE_CA_CERT === "" ? null : env.DATABASE_CA_CERT;
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (caCert === null && !(loopback && (env.APP_ENV === "local" || env.APP_ENV === "test"))) {
    throw new Error("DATABASE_CA_CERT is required except for local/test loopback targets");
  }
  if (restore && (!(env.APP_ENV === "local" || env.APP_ENV === "test") || !loopback)) {
    throw new Error("restore is restricted to a local/test loopback database");
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  // pg_restore's --dbname accepts conninfo/URI strings, which could override the checked host.
  if (restore && (databaseName.includes("=") || /^postgres(?:ql)?:/i.test(databaseName))) {
    throw new Error("restore requires a database name, not connection options");
  }
  return { url, caCert };
}

export function parsePassphrase(env) {
  const passphrase = requiredEnv(env, "BACKUP_ENCRYPTION_PASSPHRASE");
  if (passphrase.length < 32) throw new Error("BACKUP_ENCRYPTION_PASSPHRASE must contain at least 32 characters");
  return passphrase;
}

export function externalAbsolutePath(value, repositoryRoot, name) {
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  const resolved = path.resolve(value);
  // Resolve existing junctions/symlinks so a path outside the checkout cannot point back into it.
  const canonicalRoot = existsSync(repositoryRoot) ? realpathSync(repositoryRoot) : path.resolve(repositoryRoot);
  const parent = path.dirname(resolved);
  const canonicalPath = existsSync(resolved) ? realpathSync(resolved)
    : existsSync(parent) ? path.join(realpathSync(parent), path.basename(resolved)) : resolved;
  const relative = path.relative(canonicalRoot, canonicalPath);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error(`${name} must be outside the repository`);
  }
  return resolved;
}

export function childBaseEnvironment(env) {
  const childEnv = { ...env };
  // PGHOSTADDR, PGSERVICE and PGOPTIONS must not override the explicitly verified target.
  for (const name of Object.keys(childEnv)) {
    if (name.toUpperCase().startsWith("PG")) delete childEnv[name];
  }
  for (const name of [
    "MIGRATION_DATABASE_URL",
    "DATABASE_CA_CERT",
    "BACKUP_ENCRYPTION_PASSPHRASE",
    "BACKUP_OUTPUT_PATH",
    "BACKUP_INPUT_PATH",
    "RESTORE_CONFIRM_EMPTY_DATABASE",
  ]) {
    delete childEnv[name];
  }
  return childEnv;
}

export async function withLibpqEnvironment(target, env, work) {
  let caDirectory = null;
  try {
    const childEnv = childBaseEnvironment(env);
    childEnv.PGHOST = target.url.hostname === "[::1]" ? "::1" : target.url.hostname;
    childEnv.PGPORT = target.url.port || "5432";
    childEnv.PGUSER = decodeURIComponent(target.url.username);
    childEnv.PGPASSWORD = decodeURIComponent(target.url.password);
    childEnv.PGDATABASE = decodeURIComponent(target.url.pathname.slice(1));
    childEnv.PGAPPNAME = "freshapples-operator-backup";
    if (target.caCert === null) {
      childEnv.PGSSLMODE = "disable";
    } else {
      caDirectory = await mkdtemp(path.join(tmpdir(), "freshapples-db-ca-"));
      const caPath = path.join(caDirectory, "root.crt");
      await writeFile(caPath, target.caCert, { encoding: "utf8", mode: 0o600, flag: "wx" });
      childEnv.PGSSLMODE = "verify-full";
      childEnv.PGSSLROOTCERT = caPath;
    }
    return await work(childEnv);
  } finally {
    if (caDirectory !== null) await rm(caDirectory, { recursive: true, force: true });
  }
}

export function pgClientConfig(target) {
  return {
    connectionString: target.url.href,
    ssl: target.caCert === null ? false : { ca: target.caCert, rejectUnauthorized: true },
  };
}

export async function assertDisposableDatabaseEmpty(client) {
  const roles = await client.query(
    "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname",
    [REQUIRED_DATABASE_ROLES],
  );
  const present = new Set(roles.rows.map((row) => row.rolname));
  if (REQUIRED_DATABASE_ROLES.some((role) => !present.has(role))) {
    throw new Error("required D-31 roles must be provisioned by the operator before restore");
  }
  const objects = await client.query(`
    SELECT count(*)::int AS object_count
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'information_schema'
      AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  `);
  if (objects.rows[0]?.object_count !== 0) throw new Error("restore database is not empty");
}
