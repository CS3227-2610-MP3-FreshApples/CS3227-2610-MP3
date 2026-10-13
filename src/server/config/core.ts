import "server-only";

import { z } from "zod";

import { integerString, parseUrl, pickVariables, REQUIRED, secretString, toIssues } from "./env-schema";
import type { AppEnv, CoreConfigResult, EnvRecord } from "./types";

const APP_ENVS = ["local", "test", "development", "production"] as const satisfies readonly AppEnv[];
const HOSTED_APP_ENVS: ReadonlySet<string> = new Set<AppEnv>(["development", "production"]);
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

function isOrigin(value: string): boolean {
  const url = parseUrl(value);
  return url !== null && (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
}

function isPostgresUrl(value: string): boolean {
  const url = parseUrl(value);
  if (url === null || (url.protocol !== "postgres:" && url.protocol !== "postgresql:") || url.hostname === "") {
    return false;
  }
  return ![...url.searchParams.keys()].some((key) => key.toLowerCase().startsWith("ssl"));
}

function isLoopbackDatabase(databaseUrl: string): boolean {
  const url = parseUrl(databaseUrl);
  return url !== null && LOOPBACK_HOSTS.has(url.hostname);
}

const coreSchema = z
  .strictObject({
    APP_ENV: z.enum(APP_ENVS, { error: "must be one of local, test, development or production" }),
    PUBLIC_APP_URL: z
      .string({ error: REQUIRED })
      .refine(isOrigin, "must be an absolute http(s) origin with no path, query or fragment"),
    DATABASE_URL: z
      .string({ error: REQUIRED })
      .refine(isPostgresUrl, "must be a postgres:// or postgresql:// URL with no ssl* query parameter"),
    DATABASE_CA_CERT: z.string().regex(PEM_CERTIFICATE, "must contain a PEM certificate block").optional(),
    SESSION_SECRET: secretString(),
    RATE_LIMIT_KEY_SECRET: secretString(),
    SESSION_TTL_SECONDS: integerString(60, 28800).default(28800),
    REPORT_SUSPENSION_THRESHOLD: integerString(1).default(3),
  })
  .superRefine((env, ctx) => {
    const hosted = HOSTED_APP_ENVS.has(env.APP_ENV);
    if (hosted && !env.PUBLIC_APP_URL.startsWith("https:")) {
      ctx.addIssue({ code: "custom", path: ["PUBLIC_APP_URL"], message: "must use https in development and production" });
    }
    if (env.SESSION_SECRET === env.RATE_LIMIT_KEY_SECRET) {
      ctx.addIssue({ code: "custom", path: ["RATE_LIMIT_KEY_SECRET"], message: "must differ from SESSION_SECRET" });
    }
    if (env.DATABASE_CA_CERT === undefined) {
      if (hosted) {
        ctx.addIssue({ code: "custom", path: ["DATABASE_CA_CERT"], message: "is required in development and production" });
      } else if (!isLoopbackDatabase(env.DATABASE_URL)) {
        ctx.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: "must use a loopback host when DATABASE_CA_CERT is unset (D-30)",
        });
      }
    }
  });

const CORE_VARIABLES = Object.keys(coreSchema.shape) as (keyof typeof coreSchema.shape)[];

/** Validates the D-28 core set. Invalid input yields issues, never an exception. */
export function parseCoreConfig(env: EnvRecord): CoreConfigResult {
  const result = coreSchema.safeParse(pickVariables(env, CORE_VARIABLES));
  if (!result.success) {
    return { valid: false, issues: toIssues(result.error) };
  }
  const parsed = result.data;
  return {
    valid: true,
    value: {
      appEnv: parsed.APP_ENV,
      publicAppUrl: parsed.PUBLIC_APP_URL,
      database: { url: parsed.DATABASE_URL, caCert: parsed.DATABASE_CA_CERT ?? null },
      sessionSecret: parsed.SESSION_SECRET,
      rateLimitKeySecret: parsed.RATE_LIMIT_KEY_SECRET,
      sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
      reportSuspensionThreshold: parsed.REPORT_SUSPENSION_THRESHOLD,
    },
  };
}
