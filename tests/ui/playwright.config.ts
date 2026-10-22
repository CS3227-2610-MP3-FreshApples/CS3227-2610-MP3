import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

// Presentation tests use intercepted synthetic API responses, never a database or live account.
// Build first, then: npx playwright test --config tests/ui/playwright.config.ts
const root = resolve(__dirname, "../..");
const blankEnvironment = Object.fromEntries(
  (readFileSync(resolve(root, ".env.example"), "utf8").match(/^[A-Z][A-Z0-9_]*(?==)/gm) ?? []).map((name) => [name, ""]),
);

export default defineConfig({
  testDir: ".",
  outputDir: "../../.next/ui-test-results",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3112", browserName: "chromium" },
  webServer: {
    cwd: root,
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3112",
    url: "http://127.0.0.1:3112/admin",
    reuseExistingServer: false,
    env: { ...blankEnvironment },
  },
});
