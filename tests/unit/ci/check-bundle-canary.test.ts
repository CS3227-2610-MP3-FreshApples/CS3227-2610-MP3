import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CANARY_VARIABLES, canaryValues, findCanaries } from "../../../scripts/check-bundle-canary.mjs";

// Synthetic canary values only; none of these are real credentials.
const CANARY_ENV: Record<string, string> = {
  DATABASE_URL: "postgresql://app_runtime:test-canary-database-url@127.0.0.1:5432/postgres",
  MIGRATION_DATABASE_URL: "postgresql://migrator:test-canary-migration-url@127.0.0.1:5432/postgres",
  SESSION_SECRET: "test-canary-session-secret",
  RATE_LIMIT_KEY_SECRET: "test-canary-rate-limit-key",
  CRON_SECRET: "test-canary-cron-secret",
  SOC_LLM_API_KEY: "test-canary-soc-llm-api-key",
  ADMIN_BOOTSTRAP_EMAIL: "test-canary-admin@example.test",
  ADMIN_BOOTSTRAP_PASSWORD: "test-canary-admin-password1!",
  ADMIN_BOOTSTRAP_SECRET: "test-canary-admin-bootstrap-secret",
};

describe("canaryValues", () => {
  it("covers every server-only secret named in D-41", () => {
    expect([...CANARY_VARIABLES].sort()).toEqual(
      [
        "ADMIN_BOOTSTRAP_EMAIL",
        "ADMIN_BOOTSTRAP_PASSWORD",
        "ADMIN_BOOTSTRAP_SECRET",
        "CRON_SECRET",
        "DATABASE_URL",
        "MIGRATION_DATABASE_URL",
        "RATE_LIMIT_KEY_SECRET",
        "SESSION_SECRET",
        "SOC_LLM_API_KEY",
      ].sort(),
    );
  });

  it("takes connection-string canaries from the password", () => {
    const { canaries, problems } = canaryValues(CANARY_ENV);
    expect(problems).toEqual([]);
    expect(canaries).toContainEqual({ variable: "DATABASE_URL", value: "test-canary-database-url" });
    expect(canaries).toContainEqual({ variable: "MIGRATION_DATABASE_URL", value: "test-canary-migration-url" });
    expect(canaries).toContainEqual({ variable: "SESSION_SECRET", value: "test-canary-session-secret" });
  });

  it("rejects a missing canary, so the check cannot pass vacuously", () => {
    const { problems } = canaryValues({ ...CANARY_ENV, CRON_SECRET: undefined });
    expect(problems).toEqual([expect.stringContaining("CRON_SECRET")]);
  });

  it("rejects a connection string without a password", () => {
    const { problems } = canaryValues({ ...CANARY_ENV, DATABASE_URL: "postgresql://app_runtime@127.0.0.1:5432/postgres" });
    expect(problems).toEqual([expect.stringContaining("DATABASE_URL")]);
  });

  it("rejects a short canary that could match by coincidence", () => {
    const { problems } = canaryValues({ ...CANARY_ENV, SESSION_SECRET: "short" });
    expect(problems).toEqual([expect.stringContaining("SESSION_SECRET")]);
  });

  it("rejects a canary reused by two variables", () => {
    const { problems } = canaryValues({ ...CANARY_ENV, CRON_SECRET: CANARY_ENV.SESSION_SECRET });
    expect(problems).toEqual([expect.stringContaining("CRON_SECRET")]);
  });
});

describe("findCanaries", () => {
  let staticDir: string;
  const { canaries } = canaryValues(CANARY_ENV);

  beforeEach(() => {
    staticDir = mkdtempSync(path.join(tmpdir(), "mp3-canary-"));
    mkdirSync(path.join(staticDir, "chunks", "app"), { recursive: true });
    writeFileSync(path.join(staticDir, "chunks", "main.js"), "console.log('no secrets here');");
  });

  afterEach(() => {
    rmSync(staticDir, { recursive: true, force: true });
  });

  it("finds nothing in clean assets", () => {
    expect(findCanaries(staticDir, canaries)).toEqual([]);
  });

  it("finds a canary in a nested file and names the variable and path", () => {
    writeFileSync(path.join(staticDir, "chunks", "app", "page.js"), `const k="${CANARY_ENV.SOC_LLM_API_KEY}";`);
    expect(findCanaries(staticDir, canaries)).toEqual([
      { variable: "SOC_LLM_API_KEY", file: path.join("chunks", "app", "page.js") },
    ]);
  });

  it("finds a connection-string password even without the rest of the URL", () => {
    writeFileSync(path.join(staticDir, "leak.js"), `x="test-canary-database-url"`);
    expect(findCanaries(staticDir, canaries)).toEqual([{ variable: "DATABASE_URL", file: "leak.js" }]);
  });

  it("finds a canary inside binary content", () => {
    const bytes = Buffer.concat([Buffer.from([0, 255, 1]), Buffer.from(CANARY_ENV.CRON_SECRET), Buffer.from([0])]);
    writeFileSync(path.join(staticDir, "font.woff2"), bytes);
    expect(findCanaries(staticDir, canaries)).toEqual([{ variable: "CRON_SECRET", file: "font.woff2" }]);
  });
});
