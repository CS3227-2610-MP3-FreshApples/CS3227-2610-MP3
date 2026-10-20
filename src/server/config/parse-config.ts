import "server-only";

import { z } from "zod";

import { parseAiConfig } from "./ai";
import { parseCoreConfig } from "./core";
import { deepFreeze, pickVariables, secretString, toIssues } from "./env-schema";
import type { AdminBootstrapConfig, AppConfig, CronConfig, EnvRecord, LogLevel } from "./types";
import { validatePassword } from "../services/identity/password-policy";

const cronSchema = z.strictObject({ CRON_SECRET: secretString() });
const bootstrapSchema = z.strictObject({
  ADMIN_BOOTSTRAP_SECRET: secretString(),
  ADMIN_BOOTSTRAP_EMAIL: z.email(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().refine(validatePassword),
});
const logLevelSchema = z.enum(["debug", "info", "warn", "error"] as const satisfies readonly LogLevel[]);

/** CRON_SECRET is not core: an absent or invalid value disables cron instead (D-28). */
function parseCronConfig(env: EnvRecord): CronConfig {
  const result = cronSchema.safeParse(pickVariables(env, ["CRON_SECRET"]));
  return result.success
    ? { enabled: true, secret: result.data.CRON_SECRET }
    : { enabled: false, issues: toIssues(result.error) };
}

function parseAdminBootstrapConfig(env: EnvRecord): AdminBootstrapConfig {
  const result = bootstrapSchema.safeParse(
    pickVariables(env, ["ADMIN_BOOTSTRAP_SECRET", "ADMIN_BOOTSTRAP_EMAIL", "ADMIN_BOOTSTRAP_PASSWORD"]),
  );
  return result.success
    ? {
        enabled: true,
        secret: result.data.ADMIN_BOOTSTRAP_SECRET,
        email: result.data.ADMIN_BOOTSTRAP_EMAIL,
        password: result.data.ADMIN_BOOTSTRAP_PASSWORD,
      }
    : { enabled: false, issues: toIssues(result.error) };
}

/** LOG_LEVEL is not a readiness input and falls back to info when unset or invalid (D-28). */
function parseLogLevel(env: EnvRecord): LogLevel {
  const result = logLevelSchema.safeParse(env.LOG_LEVEL);
  return result.success ? result.data : "info";
}

/**
 * Parses an environment record into a frozen configuration (D-37). Pure: reads only `env`,
 * and never throws. The composition root calls it once per server instance with `process.env`.
 */
export function parseConfig(env: EnvRecord): AppConfig {
  return deepFreeze({
    core: parseCoreConfig(env),
    cron: parseCronConfig(env),
    bootstrap: parseAdminBootstrapConfig(env),
    ai: parseAiConfig(env, env.APP_ENV),
    logLevel: parseLogLevel(env),
  });
}
