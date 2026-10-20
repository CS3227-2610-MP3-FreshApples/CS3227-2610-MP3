// `npm run sandbox`: a long-lived local sandbox for clicking through the app by hand. Local development
// only; never used by CI, tests or deployment.
//
// It keeps a PostgreSQL 17 container (`mp3-sandbox`, data in the Docker volume `mp3-sandbox-data`, bound to
// 127.0.0.1:55433), applies every migration, creates a login role that is a member of `app_runtime` (D-31),
// starts `next dev` on http://localhost:3001 against it, and provisions a synthetic first Admin through the
// real bootstrap endpoint (D-83). Generated secrets and the Admin credentials live in `.env.sandbox.local`
// (git-ignored by `.env*.local`); edit the Admin email/password there before the first run to choose your
// own. Data persists across runs. `npm run sandbox -- --reset` drops the sandbox database first.
//
// The shared Supabase settings in `.env.local` are never used: every application variable is set
// explicitly, blank where unused, so `next dev` cannot fall back to them.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { migrateUp } from "../src/server/db/migrate.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STATE_FILE = path.join(ROOT, ".env.sandbox.local");
const CONTAINER = "mp3-sandbox";
const VOLUME = "mp3-sandbox-data";
const DB_PORT = 55433;
const DATABASE = "mp3_sandbox";
const LOGIN_ROLE = "mp3_sandbox_app";
const APP_PORT = 3001;
const APP_URL = `http://localhost:${APP_PORT}`;
/** Created by an operator on Supabase; NOLOGIN stand-ins here so migrations run unchanged (D-31). */
const SYNTHETIC_ROLES = ["app_runtime", "anon", "authenticated"];
const NEXT_BIN = createRequire(import.meta.url).resolve("next/dist/bin/next");

function secret() {
  return randomBytes(32).toString("hex");
}

/** Reads `.env.sandbox.local`, creating it with fresh secrets on the first run. */
function loadState() {
  if (!existsSync(STATE_FILE)) {
    const initial = {
      SANDBOX_POSTGRES_PASSWORD: secret(),
      SANDBOX_APP_PASSWORD: secret(),
      SESSION_SECRET: secret(),
      RATE_LIMIT_KEY_SECRET: secret(),
      CRON_SECRET: secret(),
      ADMIN_BOOTSTRAP_SECRET: secret(),
      ADMIN_BOOTSTRAP_EMAIL: "admin@sandbox.test",
      // 12–128 characters with a number and a special character (password policy).
      ADMIN_BOOTSTRAP_PASSWORD: `Sandbox-${randomBytes(6).toString("hex")}-1!`,
    };
    const lines = [
      "# Local sandbox only (scripts/sandbox.mjs). Synthetic values; never reuse them elsewhere.",
      "# The Admin email/password take effect only when the Admin is first provisioned (or after --reset).",
      ...Object.entries(initial).map(([key, value]) => `${key}=${value}`),
    ];
    writeFileSync(STATE_FILE, `${lines.join("\n")}\n`, { mode: 0o600 });
  }
  const state = {};
  for (const line of readFileSync(STATE_FILE, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match !== null) state[match[1]] = match[2];
  }
  return state;
}

function docker(...args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function ensureContainer(postgresPassword) {
  let status = "";
  try {
    status = docker("inspect", "--format", "{{.State.Status}}", CONTAINER);
  } catch {
    status = "missing";
  }
  if (status === "missing") {
    console.log(`sandbox: creating container ${CONTAINER} (data volume ${VOLUME})`);
    docker(
      "run", "--name", CONTAINER, "-d",
      "-e", `POSTGRES_PASSWORD=${postgresPassword}`,
      "-v", `${VOLUME}:/var/lib/postgresql/data`,
      "-p", `127.0.0.1:${DB_PORT}:5432`,
      "postgres:17",
    );
  } else if (status !== "running") {
    console.log(`sandbox: starting container ${CONTAINER}`);
    docker("start", CONTAINER);
  }
}

function serverUrl(state, database = "postgres") {
  return `postgresql://postgres:${encodeURIComponent(state.SANDBOX_POSTGRES_PASSWORD)}@127.0.0.1:${DB_PORT}/${database}`;
}

async function withClient(url, work) {
  const client = new pg.Client({ connectionString: url, ssl: false });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function waitFor(what, attempt, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function prepareDatabase(state, reset) {
  await waitFor("PostgreSQL", () => withClient(serverUrl(state), (client) => client.query("SELECT 1")));
  await withClient(serverUrl(state), async (client) => {
    if (reset) {
      console.log(`sandbox: --reset, dropping database ${DATABASE}`);
      await client.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    }
    for (const role of SYNTHETIC_ROLES) {
      await client.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    }
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [DATABASE]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE ${DATABASE}`);
    const password = client.escapeLiteral(state.SANDBOX_APP_PASSWORD);
    await client.query(`DO $$ BEGIN CREATE ROLE ${LOGIN_ROLE} LOGIN INHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await client.query(`ALTER ROLE ${LOGIN_ROLE} LOGIN INHERIT PASSWORD ${password}`);
    await client.query(`GRANT app_runtime TO ${LOGIN_ROLE} WITH INHERIT TRUE`);
  });
  // Applies only migrations not yet recorded, so new migrations on later branches land on the next run.
  await migrateUp({ url: serverUrl(state, DATABASE), caCert: null }, () => undefined);
}

/** Every variable named in .env.example, blank, so `.env.local` cannot supply one (as playwright.config.ts). */
function blankedAppVariables() {
  const names = readFileSync(path.join(ROOT, ".env.example"), "utf8").match(/^[A-Z][A-Z0-9_]*(?==)/gm) ?? [];
  return Object.fromEntries(names.map((name) => [name, ""]));
}

function appEnvironment(state) {
  return {
    ...process.env,
    ...blankedAppVariables(),
    APP_ENV: "local",
    PUBLIC_APP_URL: APP_URL,
    AI_ENABLED: "false",
    AI_PROVIDER: "fake",
    DATABASE_URL: `postgresql://${LOGIN_ROLE}:${encodeURIComponent(state.SANDBOX_APP_PASSWORD)}@127.0.0.1:${DB_PORT}/${DATABASE}`,
    SESSION_SECRET: state.SESSION_SECRET,
    RATE_LIMIT_KEY_SECRET: state.RATE_LIMIT_KEY_SECRET,
    CRON_SECRET: state.CRON_SECRET,
    ADMIN_BOOTSTRAP_SECRET: state.ADMIN_BOOTSTRAP_SECRET,
    ADMIN_BOOTSTRAP_EMAIL: state.ADMIN_BOOTSTRAP_EMAIL,
    ADMIN_BOOTSTRAP_PASSWORD: state.ADMIN_BOOTSTRAP_PASSWORD,
  };
}

async function provisionAdmin(state) {
  await waitFor("next dev", async () => {
    const live = await fetch(`${APP_URL}/api/v1/health/live`);
    if (!live.ok) throw new Error(`liveness ${live.status}`);
  }, 180_000);
  const response = await fetch(`${APP_URL}/api/v1/internal/bootstrap/admin`, {
    method: "POST",
    headers: { "x-admin-bootstrap-secret": state.ADMIN_BOOTSTRAP_SECRET },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Admin bootstrap failed with ${response.status} ${body?.error?.code ?? ""}`.trim());
  return body.status;
}

async function main() {
  const reset = process.argv.includes("--reset");
  const state = loadState();
  ensureContainer(state.SANDBOX_POSTGRES_PASSWORD);
  await prepareDatabase(state, reset);

  console.log(`sandbox: starting next dev on ${APP_URL}`);
  const child = spawn(process.execPath, [NEXT_BIN, "dev", "--hostname", "localhost", "--port", String(APP_PORT)], {
    cwd: ROOT,
    env: appEnvironment(state),
    stdio: "inherit",
  });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 0)));

  try {
    const status = await provisionAdmin(state);
    console.log([
      "",
      "────────────────────────────────────────────────────────────",
      ` Sandbox ready: ${APP_URL}/sign-in   (use localhost, not 127.0.0.1)`,
      ` Admin (${status}): ${state.ADMIN_BOOTSTRAP_EMAIL}`,
      ` Password: in .env.sandbox.local (ADMIN_BOOTSTRAP_PASSWORD)`,
      " Ctrl+C stops the app; the database container keeps running.",
      "────────────────────────────────────────────────────────────",
      "",
    ].join("\n"));
  } catch (error) {
    console.error(`sandbox: ${error instanceof Error ? error.message : "Admin provisioning failed"}`);
  }
  process.exitCode = await exited;
}

main().catch((error) => {
  // Messages only: connection errors could otherwise echo a URL with the sandbox password.
  console.error(`sandbox: ${error instanceof Error ? error.message : "setup failed"}`);
  process.exit(1);
});
