import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { parseConfig } from "../../../src/server/config";

// Synthetic placeholder values only; none of these are real credentials.
const SESSION_SECRET = "synthetic-session-secret-0123456789abcdef";
const RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-0123456789abcdef";
const CRON_SECRET = "synthetic-cron-secret-0123456789abcdef";
const SOC_LLM_API_KEY = "synthetic-soc-llm-api-key";
const CA_CERT = "-----BEGIN CERTIFICATE-----\nc3ludGhldGlj\n-----END CERTIFICATE-----";

const CORE_ENV = {
  APP_ENV: "production",
  PUBLIC_APP_URL: "https://app.example.test",
  DATABASE_URL: "postgresql://app_runtime:synthetic-db-password@db.example.test:6543/postgres",
  DATABASE_CA_CERT: CA_CERT,
  SESSION_SECRET,
  RATE_LIMIT_KEY_SECRET,
} as const;

const AI_ENV = {
  AI_ENABLED: "true",
  AI_PROVIDER: "soc_llm",
  SOC_LLM_BASE_URL: "https://llm.example.test/api",
  SOC_LLM_API_KEY,
  SOC_LLM_MODEL: "synthetic-model",
  SOC_LLM_REQUESTS_PER_MINUTE: "60",
  SOC_LLM_TOKENS_PER_MINUTE: "100000",
  AI_DAILY_BUDGET_MICRODOLLARS: "53333333",
  SOC_LLM_INPUT_PRICE_MICRODOLLARS_PER_MTOK: "150000",
  SOC_LLM_OUTPUT_PRICE_MICRODOLLARS_PER_MTOK: "600000",
} as const;

const VALID_ENV: Record<string, string> = { ...CORE_ENV, ...AI_ENV, CRON_SECRET };

function envWith(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...VALID_ENV, ...overrides };
}

function issueVariables(issues: readonly { variable: string }[]): string[] {
  return issues.map((issue) => issue.variable);
}

describe("parseConfig — valid configuration", () => {
  it("parses a complete environment into valid core, cron and ai sections", () => {
    const config = parseConfig(VALID_ENV);

    expect(config.core).toEqual({
      valid: true,
      value: {
        appEnv: "production",
        publicAppUrl: "https://app.example.test",
        database: { url: CORE_ENV.DATABASE_URL, caCert: CA_CERT },
        sessionSecret: SESSION_SECRET,
        rateLimitKeySecret: RATE_LIMIT_KEY_SECRET,
        sessionTtlSeconds: 28800,
        reportSuspensionThreshold: 3,
      },
    });
    expect(config.cron).toEqual({ enabled: true, secret: CRON_SECRET });
    expect(config.logLevel).toBe("info");
  });

  it("applies the deployment.md 10.3 AI defaults", () => {
    const config = parseConfig(VALID_ENV);

    expect(config.ai).toEqual({
      enabled: true,
      value: {
        provider: "soc_llm",
        soc: { baseUrl: "https://llm.example.test/api", apiKey: SOC_LLM_API_KEY, model: "synthetic-model" },
        quotas: { requestsPerMinute: 60, tokensPerMinute: 100000 },
        budget: {
          dailyMicrodollars: 53333333,
          inputPriceMicrodollarsPerMTok: 150000,
          outputPriceMicrodollarsPerMTok: 600000,
        },
        execution: {
          maxConcurrentRequests: 1,
          attemptTimeoutMs: 30000,
          maxAttempts: 2,
          executionDeadlineMs: 75000,
          inputTokenLimit: 8000,
        },
        summaries: { sampleSize: 20, intervalDays: 1, maxMoviesPerRun: 1 },
        moderation: { maxExecutions: 3, recoveryMaxReviews: 1 },
      },
    });
  });

  it("uses set values for defaulted variables", () => {
    const config = parseConfig(
      envWith({
        SESSION_TTL_SECONDS: "3600",
        REPORT_SUSPENSION_THRESHOLD: "5",
        AI_SUMMARY_INTERVAL_DAYS: "7",
        AI_INPUT_TOKEN_LIMIT: "4000",
      }),
    );

    expect(config.core.valid && config.core.value.sessionTtlSeconds).toBe(3600);
    expect(config.core.valid && config.core.value.reportSuspensionThreshold).toBe(5);
    expect(config.ai.enabled && config.ai.value.summaries.intervalDays).toBe(7);
    expect(config.ai.enabled && config.ai.value.execution.inputTokenLimit).toBe(4000);
  });

  it("returns a deeply frozen object", () => {
    const config = parseConfig(VALID_ENV);

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.core)).toBe(true);
    expect(config.core.valid && Object.isFrozen(config.core.value.database)).toBe(true);
    expect(config.ai.enabled && Object.isFrozen(config.ai.value.soc)).toBe(true);
    expect(Object.isFrozen(config.cron)).toBe(true);
  });

  it("ignores unrelated environment variables", () => {
    const config = parseConfig(envWith({ PATH: "/usr/bin", NODE_ENV: "production", UNRELATED: "x" }));

    expect(config.core.valid).toBe(true);
  });

  it("treats an empty string as unset", () => {
    const config = parseConfig(envWith({ SESSION_TTL_SECONDS: "" }));

    expect(config.core.valid && config.core.value.sessionTtlSeconds).toBe(28800);
  });

  it("does not read process.env", () => {
    const config = parseConfig({});

    expect(config.core.valid).toBe(false);
  });
});

describe("parseConfig — core configuration (D-28, D-37)", () => {
  it.each(["APP_ENV", "PUBLIC_APP_URL", "DATABASE_URL", "DATABASE_CA_CERT", "SESSION_SECRET", "RATE_LIMIT_KEY_SECRET"])(
    "marks core invalid when %s is missing in production",
    (variable) => {
      const config = parseConfig(envWith({ [variable]: undefined }));

      expect(config.core.valid).toBe(false);
      expect(!config.core.valid && issueVariables(config.core.issues)).toContain(variable);
    },
  );

  it.each([
    ["APP_ENV", "staging"],
    ["PUBLIC_APP_URL", "not a url"],
    ["PUBLIC_APP_URL", "https://app.example.test/path"],
    ["PUBLIC_APP_URL", "https://app.example.test/?q=1"],
    ["PUBLIC_APP_URL", "http://app.example.test"],
    ["PUBLIC_APP_URL", "ftp://app.example.test"],
    ["DATABASE_URL", "mysql://user:pw@db.example.test:3306/db"],
    ["DATABASE_URL", "postgresql://user:pw@db.example.test:6543/postgres?sslmode=require"],
    ["DATABASE_URL", "postgresql://user:pw@db.example.test:6543/postgres?sslrootcert=x"],
    ["DATABASE_CA_CERT", "no pem block here"],
    ["SESSION_SECRET", "too-short"],
    ["RATE_LIMIT_KEY_SECRET", "too-short"],
    ["RATE_LIMIT_KEY_SECRET", SESSION_SECRET],
    ["SESSION_TTL_SECONDS", "59"],
    ["SESSION_TTL_SECONDS", "28801"],
    ["SESSION_TTL_SECONDS", "3600.5"],
    ["SESSION_TTL_SECONDS", "abc"],
    ["REPORT_SUSPENSION_THRESHOLD", "0"],
    ["REPORT_SUSPENSION_THRESHOLD", "-1"],
  ])("marks core invalid when %s is %j", (variable, value) => {
    const config = parseConfig(envWith({ [variable]: value }));

    expect(config.core.valid).toBe(false);
    expect(!config.core.valid && issueVariables(config.core.issues)).toContain(variable);
  });

  it("accepts an HTTP origin in local", () => {
    const config = parseConfig(envWith({ APP_ENV: "local", PUBLIC_APP_URL: "http://localhost:3000" }));

    expect(config.core.valid).toBe(true);
  });

  it.each(["local", "test"])("allows a missing CA certificate in %s with a loopback database (D-30)", (appEnv) => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const config = parseConfig(
        envWith({
          APP_ENV: appEnv,
          DATABASE_URL: `postgres://app_runtime:pw@${host}:5432/app`,
          DATABASE_CA_CERT: undefined,
        }),
      );

      expect(config.core.valid && config.core.value.database.caCert).toBeNull();
    }
  });

  it("rejects a missing CA certificate in local with a non-loopback database (D-30)", () => {
    const config = parseConfig(envWith({ APP_ENV: "local", DATABASE_CA_CERT: undefined }));

    expect(config.core.valid).toBe(false);
    expect(!config.core.valid && issueVariables(config.core.issues)).toContain("DATABASE_URL");
  });

  it("rejects a missing CA certificate in development even with a loopback database", () => {
    const config = parseConfig(
      envWith({
        APP_ENV: "development",
        DATABASE_URL: "postgres://app_runtime:pw@localhost:5432/app",
        DATABASE_CA_CERT: undefined,
      }),
    );

    expect(config.core.valid).toBe(false);
    expect(!config.core.valid && issueVariables(config.core.issues)).toContain("DATABASE_CA_CERT");
  });
});

describe("parseConfig — cron configuration", () => {
  it("keeps core valid and disables cron when CRON_SECRET is missing", () => {
    const config = parseConfig(envWith({ CRON_SECRET: undefined }));

    expect(config.core.valid).toBe(true);
    expect(config.cron.enabled).toBe(false);
  });

  it("treats a CRON_SECRET shorter than 32 characters as missing", () => {
    const config = parseConfig(envWith({ CRON_SECRET: "too-short" }));

    expect(config.core.valid).toBe(true);
    expect(config.cron.enabled).toBe(false);
    expect(!config.cron.enabled && issueVariables(config.cron.issues)).toEqual(["CRON_SECRET"]);
  });
});

describe("parseConfig — LOG_LEVEL", () => {
  it.each(["debug", "info", "warn", "error"])("accepts %s", (level) => {
    expect(parseConfig(envWith({ LOG_LEVEL: level })).logLevel).toBe(level);
  });

  it.each([undefined, "verbose", "INFO", "trace"])("falls back to info for %j without affecting core", (level) => {
    const config = parseConfig(envWith({ LOG_LEVEL: level }));

    expect(config.logLevel).toBe("info");
    expect(config.core.valid).toBe(true);
  });
});

describe("parseConfig — AI configuration (D-16, D-28, D-37)", () => {
  it("disables AI without issues when AI_ENABLED=false", () => {
    const config = parseConfig(envWith({ AI_ENABLED: "false" }));

    expect(config.ai).toEqual({ enabled: false, issues: [] });
  });

  it("disables AI when AI_ENABLED=false even if other AI variables are missing", () => {
    const config = parseConfig({ ...CORE_ENV, AI_ENABLED: "false" });

    expect(config.ai).toEqual({ enabled: false, issues: [] });
    expect(config.core.valid).toBe(true);
  });

  it.each([undefined, "TRUE", "1", "yes", "False"])("disables AI when AI_ENABLED is %j", (value) => {
    const config = parseConfig(envWith({ AI_ENABLED: value }));

    expect(config.ai.enabled).toBe(false);
    expect(!config.ai.enabled && issueVariables(config.ai.issues)).toContain("AI_ENABLED");
    expect(config.core.valid).toBe(true);
  });

  it.each([
    "AI_PROVIDER",
    "SOC_LLM_BASE_URL",
    "SOC_LLM_API_KEY",
    "SOC_LLM_MODEL",
    "SOC_LLM_REQUESTS_PER_MINUTE",
    "SOC_LLM_TOKENS_PER_MINUTE",
    "AI_DAILY_BUDGET_MICRODOLLARS",
    "SOC_LLM_INPUT_PRICE_MICRODOLLARS_PER_MTOK",
    "SOC_LLM_OUTPUT_PRICE_MICRODOLLARS_PER_MTOK",
  ])("disables AI and keeps core valid when %s is missing", (variable) => {
    const config = parseConfig(envWith({ [variable]: undefined }));

    expect(config.core.valid).toBe(true);
    expect(config.ai.enabled).toBe(false);
    expect(!config.ai.enabled && issueVariables(config.ai.issues)).toContain(variable);
  });

  it("requires the SoC variables for the fake provider too", () => {
    const config = parseConfig(envWith({ APP_ENV: "development", AI_PROVIDER: "fake", SOC_LLM_API_KEY: undefined }));

    expect(config.ai.enabled).toBe(false);
  });

  it.each(["local", "test", "development"])("accepts the fake provider in %s", (appEnv) => {
    const config = parseConfig(
      envWith({ APP_ENV: appEnv, PUBLIC_APP_URL: "https://app.example.test", AI_PROVIDER: "fake" }),
    );

    expect(config.ai.enabled && config.ai.value.provider).toBe("fake");
  });

  it("rejects the fake provider in production without invalidating core", () => {
    const config = parseConfig(envWith({ AI_PROVIDER: "fake" }));

    expect(config.core.valid).toBe(true);
    expect(config.ai.enabled).toBe(false);
    expect(!config.ai.enabled && issueVariables(config.ai.issues)).toContain("AI_PROVIDER");
  });

  it("rejects the fake provider when APP_ENV is invalid", () => {
    const config = parseConfig(envWith({ APP_ENV: "staging", AI_PROVIDER: "fake" }));

    expect(config.ai.enabled).toBe(false);
  });

  it.each([
    "https://llm.example.test/v1",
    "https://llm.example.test/v1/",
    "https://llm.example.test/api/v1",
    "http://llm.example.test/api",
    "not a url",
  ])("rejects SOC_LLM_BASE_URL %j", (value) => {
    const config = parseConfig(envWith({ SOC_LLM_BASE_URL: value }));

    expect(config.core.valid).toBe(true);
    expect(config.ai.enabled).toBe(false);
    expect(!config.ai.enabled && issueVariables(config.ai.issues)).toContain("SOC_LLM_BASE_URL");
  });

  it.each([
    ["SOC_LLM_REQUESTS_PER_MINUTE", "0"],
    ["SOC_LLM_TOKENS_PER_MINUTE", "-5"],
    ["AI_DAILY_BUDGET_MICRODOLLARS", "1.5"],
    ["SOC_LLM_INPUT_PRICE_MICRODOLLARS_PER_MTOK", "free"],
    ["AI_MAX_CONCURRENT_REQUESTS", "0"],
    ["AI_ATTEMPT_TIMEOUT_MS", "0"],
    ["AI_MAX_ATTEMPTS", "0"],
    ["AI_EXECUTION_DEADLINE_MS", "-1"],
    ["AI_SUMMARY_SAMPLE_SIZE", "21"],
    ["AI_SUMMARY_INTERVAL_DAYS", "0"],
    ["AI_SUMMARY_MAX_MOVIES_PER_RUN", "2"],
    ["AI_MODERATION_MAX_EXECUTIONS", "0"],
    ["AI_MODERATION_RECOVERY_MAX_REVIEWS", "2"],
    ["AI_INPUT_TOKEN_LIMIT", "8001"],
    ["AI_INPUT_TOKEN_LIMIT", "99999999999999999999"],
  ])("disables AI when %s is %j", (variable, value) => {
    const config = parseConfig(envWith({ [variable]: value }));

    expect(config.core.valid).toBe(true);
    expect(config.ai.enabled).toBe(false);
    expect(!config.ai.enabled && issueVariables(config.ai.issues)).toContain(variable);
  });
});

describe("parseConfig — secret handling", () => {
  it("never includes a variable value in any issue", () => {
    const leakedValues = {
      APP_ENV: "leak-marker-app-env",
      PUBLIC_APP_URL: "http://leak-marker-origin.example.test/leak-marker-path",
      DATABASE_URL: "postgresql://user:leak-marker-db-password@leak-marker-host:6543/db?sslmode=leak-marker",
      DATABASE_CA_CERT: "leak-marker-ca",
      SESSION_SECRET: "leak-marker-session",
      RATE_LIMIT_KEY_SECRET: "leak-marker-session",
      SESSION_TTL_SECONDS: "leak-marker-ttl",
      REPORT_SUSPENSION_THRESHOLD: "leak-marker-threshold",
      CRON_SECRET: "leak-marker-cron",
      LOG_LEVEL: "leak-marker-log",
      AI_ENABLED: "leak-marker-enabled",
      AI_PROVIDER: "leak-marker-provider",
      SOC_LLM_BASE_URL: "https://leak-marker-llm.example.test/v1",
      SOC_LLM_API_KEY: "",
      SOC_LLM_MODEL: "",
      SOC_LLM_REQUESTS_PER_MINUTE: "leak-marker-rpm",
      SOC_LLM_TOKENS_PER_MINUTE: "leak-marker-tpm",
      AI_DAILY_BUDGET_MICRODOLLARS: "leak-marker-budget",
      SOC_LLM_INPUT_PRICE_MICRODOLLARS_PER_MTOK: "leak-marker-in",
      SOC_LLM_OUTPUT_PRICE_MICRODOLLARS_PER_MTOK: "leak-marker-out",
      AI_INPUT_TOKEN_LIMIT: "leak-marker-tokens",
    };

    const config = parseConfig(leakedValues);

    expect(config.core.valid).toBe(false);
    expect(config.ai.enabled).toBe(false);
    expect(config.cron.enabled).toBe(false);
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain("leak-marker");
  });

  it("does not include secrets in issues when only a cross-field rule fails", () => {
    const config = parseConfig(envWith({ RATE_LIMIT_KEY_SECRET: SESSION_SECRET }));

    expect(config.core.valid).toBe(false);
    expect(JSON.stringify(config)).not.toContain(SESSION_SECRET);
  });

  it("does not include the API key when AI is disabled by another variable", () => {
    const config = parseConfig(envWith({ SOC_LLM_BASE_URL: "https://llm.example.test/v1" }));

    expect(JSON.stringify(config)).not.toContain(SOC_LLM_API_KEY);
  });

  it("never throws for malformed input", () => {
    expect(() => parseConfig({})).not.toThrow();
    expect(() => parseConfig({ APP_ENV: "\u0000", DATABASE_URL: "postgresql://[bad" })).not.toThrow();
  });
});
