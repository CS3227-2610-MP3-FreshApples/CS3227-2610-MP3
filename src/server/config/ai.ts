import "server-only";

import { z } from "zod";

import { integerString, parseUrl, pickVariables, REQUIRED, toIssues } from "./env-schema";
import type { AiConfig, AiProvider, AppEnv, ConfigIssue, EnvRecord } from "./types";

const AI_PROVIDERS = ["soc_llm", "fake"] as const satisfies readonly AiProvider[];
/** The fake adapter is for local, test and development only (D-16, D-37). */
const FAKE_PROVIDER_APP_ENVS: ReadonlySet<string> = new Set<AppEnv>(["local", "test", "development"]);

function isSocBaseUrl(value: string): boolean {
  const url = parseUrl(value);
  return url !== null && url.protocol === "https:" && !/\/v1\/?$/.test(url.pathname);
}

// Required variables have no default (deployment.md 10.3); defaults and maxima are from the same table.
const aiSchema = z.strictObject({
  AI_PROVIDER: z.enum(AI_PROVIDERS, { error: "must be soc_llm or fake" }),
  SOC_LLM_BASE_URL: z
    .string({ error: REQUIRED })
    .refine(isSocBaseUrl, "must be an https URL that does not end in /v1"),
  SOC_LLM_API_KEY: z.string({ error: REQUIRED }),
  SOC_LLM_MODEL: z.string({ error: REQUIRED }),
  SOC_LLM_REQUESTS_PER_MINUTE: integerString(1),
  AI_DAILY_BUDGET_MICRODOLLARS: integerString(1),
  SOC_LLM_INPUT_PRICE_MICRODOLLARS_PER_MTOK: integerString(1),
  SOC_LLM_OUTPUT_PRICE_MICRODOLLARS_PER_MTOK: integerString(1),
  // D-65 maxima and the D-76 minimum deadline; smaller values are allowed, for example in tests.
  AI_MAX_CONCURRENT_REQUESTS: integerString(1, 1).default(1),
  AI_ATTEMPT_TIMEOUT_MS: integerString(1, 30000).default(30000),
  AI_MAX_ATTEMPTS: integerString(1, 2).default(2),
  AI_EXECUTION_DEADLINE_MS: integerString(15000, 75000).default(75000),
  // D-86: below 3 no sample could be published.
  AI_SUMMARY_SAMPLE_SIZE: integerString(3, 20).default(20),
  AI_SUMMARY_INTERVAL_DAYS: integerString(1).default(1),
  AI_SUMMARY_MAX_MOVIES_PER_RUN: integerString(1, 1).default(1),
  AI_MODERATION_MAX_EXECUTIONS: integerString(1).default(3),
  AI_MODERATION_RECOVERY_MAX_REVIEWS: integerString(1, 1).default(1),
  AI_INPUT_TOKEN_LIMIT: integerString(1, 8000).default(8000),
});

const AI_VARIABLES = Object.keys(aiSchema.shape) as (keyof typeof aiSchema.shape)[];

/** The larger AI-03 output cap (summaries); the D-78 minimum budget is sized with it. */
const MAX_OUTPUT_TOKENS = BigInt(1_200);
const TOKENS_PER_MTOK = BigInt(1_000_000);

/**
 * D-78: the AI-03 reservation for `inputTokenLimit` input tokens and 1,200 output tokens, rounded up. BigInt keeps
 * it exact for any configured price; the runtime prices each reservation with the same formula.
 */
function maximumReservationMicrodollars(inputTokenLimit: number, inputPrice: number, outputPrice: number): bigint {
  const numerator = BigInt(inputTokenLimit) * BigInt(inputPrice) + MAX_OUTPUT_TOKENS * BigInt(outputPrice);
  return (numerator + TOKENS_PER_MTOK - BigInt(1)) / TOKENS_PER_MTOK;
}

/**
 * Validates the AI settings. Any problem disables AI and is reported by variable name;
 * it never makes core configuration invalid (D-28, D-37).
 *
 * @param appEnv the raw APP_ENV value; the fake provider is refused unless it is local, test or development.
 */
export function parseAiConfig(env: EnvRecord, appEnv: string | undefined): AiConfig {
  if (env.AI_ENABLED === "false") {
    return { enabled: false, issues: [] };
  }

  const issues: ConfigIssue[] = [];
  if (env.AI_ENABLED !== "true") {
    issues.push({ variable: "AI_ENABLED", message: "must be exactly true or false" });
  }

  const result = aiSchema.safeParse(pickVariables(env, AI_VARIABLES));
  if (!result.success) {
    issues.push(...toIssues(result.error));
    return { enabled: false, issues };
  }

  const parsed = result.data;
  if (parsed.AI_PROVIDER === "fake" && (appEnv === undefined || !FAKE_PROVIDER_APP_ENVS.has(appEnv))) {
    issues.push({ variable: "AI_PROVIDER", message: "fake is permitted only when APP_ENV is local, test or development" });
  }
  const maximumReservation = maximumReservationMicrodollars(
    parsed.AI_INPUT_TOKEN_LIMIT,
    parsed.SOC_LLM_INPUT_PRICE_MICRODOLLARS_PER_MTOK,
    parsed.SOC_LLM_OUTPUT_PRICE_MICRODOLLARS_PER_MTOK,
  );
  if (BigInt(parsed.AI_DAILY_BUDGET_MICRODOLLARS) < maximumReservation) {
    issues.push({
      variable: "AI_DAILY_BUDGET_MICRODOLLARS",
      message: "must fit one reservation for AI_INPUT_TOKEN_LIMIT input and 1200 output tokens at the configured prices",
    });
  }
  if (issues.length > 0) {
    return { enabled: false, issues };
  }

  return {
    enabled: true,
    value: {
      provider: parsed.AI_PROVIDER,
      soc: { baseUrl: parsed.SOC_LLM_BASE_URL, apiKey: parsed.SOC_LLM_API_KEY, model: parsed.SOC_LLM_MODEL },
      quotas: {
        requestsPerMinute: parsed.SOC_LLM_REQUESTS_PER_MINUTE,
      },
      budget: {
        dailyMicrodollars: parsed.AI_DAILY_BUDGET_MICRODOLLARS,
        inputPriceMicrodollarsPerMTok: parsed.SOC_LLM_INPUT_PRICE_MICRODOLLARS_PER_MTOK,
        outputPriceMicrodollarsPerMTok: parsed.SOC_LLM_OUTPUT_PRICE_MICRODOLLARS_PER_MTOK,
      },
      execution: {
        maxConcurrentRequests: parsed.AI_MAX_CONCURRENT_REQUESTS,
        attemptTimeoutMs: parsed.AI_ATTEMPT_TIMEOUT_MS,
        maxAttempts: parsed.AI_MAX_ATTEMPTS,
        executionDeadlineMs: parsed.AI_EXECUTION_DEADLINE_MS,
        inputTokenLimit: parsed.AI_INPUT_TOKEN_LIMIT,
      },
      summaries: {
        sampleSize: parsed.AI_SUMMARY_SAMPLE_SIZE,
        intervalDays: parsed.AI_SUMMARY_INTERVAL_DAYS,
        maxMoviesPerRun: parsed.AI_SUMMARY_MAX_MOVIES_PER_RUN,
      },
      moderation: {
        maxExecutions: parsed.AI_MODERATION_MAX_EXECUTIONS,
        recoveryMaxReviews: parsed.AI_MODERATION_RECOVERY_MAX_REVIEWS,
      },
    },
  };
}
