// `npm run test:e2e` (D-42). Playwright starts webServer before globalSetup, so this wrapper prepares the
// database and login role, runs `playwright test` with the e2e environment, and cleans up even when tests
// fail. It does not build: run `npm run build` first. Extra arguments are passed to `playwright test`.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

import {
  createLoginRole,
  createMigratedDatabase,
  dropLoginRole,
  testServerUrl,
  withServer,
} from "./test-database.mjs";

const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve("@playwright/test/cli");

/** 64 hex characters: above the 32-character minimum in deployment.md 10.3. */
function randomSecret() {
  return randomBytes(32).toString("hex");
}

/**
 * Runs `playwright test` and resolves with its exit code. Ctrl+C reaches Playwright directly, so the
 * wrapper ignores it and waits; SIGTERM is forwarded. Either way cleanup still runs afterwards.
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number>}
 */
function runPlaywright(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, "test", ...process.argv.slice(2)], {
      env,
      stdio: "inherit",
    });
    const ignoreInterrupt = () => undefined;
    const forwardTerminate = () => child.kill("SIGTERM");
    process.on("SIGINT", ignoreInterrupt);
    process.on("SIGTERM", forwardTerminate);
    const detach = () => {
      process.off("SIGINT", ignoreInterrupt);
      process.off("SIGTERM", forwardTerminate);
    };
    child.on("error", (error) => {
      detach();
      reject(error);
    });
    child.on("exit", (code) => {
      detach();
      resolve(code ?? 1);
    });
  });
}

/**
 * Runs each cleanup step even if an earlier one fails, and reports failures without detail that could
 * carry connection strings or the password.
 * @param {Array<[string, () => Promise<void>]>} steps
 */
async function cleanUp(steps) {
  for (const [what, step] of steps) {
    try {
      await step();
    } catch {
      console.error(`e2e cleanup: could not ${what}; remove it from the local test server by hand`);
    }
  }
}

/** @returns {Promise<number>} Playwright's exit code */
async function main() {
  const serverUrl = testServerUrl();
  const database = await createMigratedDatabase(serverUrl, "mp3_e2e");
  const roleName = `mp3_e2e_login_${randomBytes(8).toString("hex")}`;
  try {
    const password = randomSecret();
    await withServer(serverUrl, (client) => createLoginRole(client, roleName, password));

    const appDatabaseUrl = new URL(database.url);
    appDatabaseUrl.username = roleName;
    appDatabaseUrl.password = password;

    const env = {
      ...process.env,
      DATABASE_URL: appDatabaseUrl.href,
      SESSION_SECRET: randomSecret(),
      RATE_LIMIT_KEY_SECRET: randomSecret(),
      CRON_SECRET: randomSecret(),
    };
    // The superuser URL stays with the wrapper; nothing under Playwright needs it.
    delete env.TEST_DATABASE_URL;
    return await runPlaywright(env);
  } finally {
    // Dropping the database first ends the app's connections, so the role then has none left.
    await cleanUp([
      ["drop the e2e database", database.drop],
      ["drop the e2e login role", () => withServer(serverUrl, (client) => dropLoginRole(client, roleName))],
    ]);
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    // Messages only: pg and harness errors here never include the password, but a stack or error object could.
    console.error(`e2e setup failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  },
);
