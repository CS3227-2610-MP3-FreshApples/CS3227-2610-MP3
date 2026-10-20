import { readFileSync } from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// Playwright harness (D-09, D-42). Run through `npm run test:e2e`, which prepares the database and the
// per-run secrets below; run `npm run build` first.

const HOST = "127.0.0.1";
const PORT = 3100;
const BASE_URL = `http://${HOST}:${PORT}`;

/** Set per run by tests/setup/e2e-run.mjs. */
function fromWrapper(name:
  | "DATABASE_URL"
  | "SESSION_SECRET"
  | "RATE_LIMIT_KEY_SECRET"
  | "CRON_SECRET"
  | "ADMIN_BOOTSTRAP_EMAIL"
  | "ADMIN_BOOTSTRAP_PASSWORD"
  | "ADMIN_BOOTSTRAP_SECRET"
): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set; run the suite with npm run test:e2e (D-42)`);
  }
  return value;
}

/**
 * Every application variable named in .env.example, set to empty, which configuration treats as unset.
 * `next start` loads .env files only for variables that are not already set, so this keeps a developer's
 * .env.local and shell (for example DATABASE_CA_CERT, D-30) out of the app under test.
 */
function blankedAppVariables(): Record<string, string> {
  const names = readFileSync(path.join(__dirname, ".env.example"), "utf8").match(/^[A-Z][A-Z0-9_]*(?==)/gm);
  return Object.fromEntries((names ?? []).map((name) => [name, ""]));
}

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: BASE_URL,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npx next start --hostname ${HOST} --port ${PORT}`,
    url: `${BASE_URL}/api/v1/health/live`,
    // Never test a server started elsewhere with a different environment.
    reuseExistingServer: false,
    stdout: "pipe",
    env: {
      ...blankedAppVariables(),
      APP_ENV: "test",
      PUBLIC_APP_URL: BASE_URL,
      AI_PROVIDER: "fake",
      AI_ENABLED: "false",
      DATABASE_URL: fromWrapper("DATABASE_URL"),
      SESSION_SECRET: fromWrapper("SESSION_SECRET"),
      RATE_LIMIT_KEY_SECRET: fromWrapper("RATE_LIMIT_KEY_SECRET"),
      CRON_SECRET: fromWrapper("CRON_SECRET"),
      ADMIN_BOOTSTRAP_EMAIL: fromWrapper("ADMIN_BOOTSTRAP_EMAIL"),
      ADMIN_BOOTSTRAP_PASSWORD: fromWrapper("ADMIN_BOOTSTRAP_PASSWORD"),
      ADMIN_BOOTSTRAP_SECRET: fromWrapper("ADMIN_BOOTSTRAP_SECRET"),
    },
  },
});
