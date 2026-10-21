import "server-only";

import { createLlmProvider, type FetchFunction } from "../../../adapters/soc-llm";
import type { AiConfig, AiSettings, AppEnv } from "../../../config";
import type { Database, Sql } from "../../../db";
import type { RateLimiter, RateLimitKeys } from "../../rate-limit";
import { createDisabledAiExecutionController } from "./disabled-controller";
import { createAiExecutionController, type AiExecutionLimits } from "./execution-controller";
import { createSchedulerLeases } from "./scheduler-leases";
import { monotonicClock, sleep, systemRandom } from "./system-time";
import type { AiExecutionController, SchedulerLeases } from "./types";

/** What the AI runtime needs from valid core configuration; `null` when core configuration is invalid. */
export interface AiRuntimePlatform {
  readonly database: Database & Sql;
  readonly rateLimiter: RateLimiter;
  readonly rateLimitKeys: RateLimitKeys;
  readonly appEnv: AppEnv;
}

export interface AiRuntime {
  readonly controller: AiExecutionController;
  /** `null` exactly when the D-52 controller stub is wired. */
  readonly schedulerLeases: SchedulerLeases | null;
  /**
   * The summary input bounds, from the same settings as the real controller, so summary reduction uses its
   * `inputTokenLimit` (D-93, AM-25). `null` exactly when the D-52 controller stub is wired.
   */
  readonly summaryLimits: { readonly sampleSize: number; readonly inputTokenLimit: number } | null;
}

function aiExecutionLimits(settings: AiSettings): AiExecutionLimits {
  return {
    maxAttempts: settings.execution.maxAttempts,
    attemptTimeoutMs: settings.execution.attemptTimeoutMs,
    executionDeadlineMs: settings.execution.executionDeadlineMs,
    inputTokenLimit: settings.execution.inputTokenLimit,
    requestsPerMinute: settings.quotas.requestsPerMinute,
    dailyBudgetMicrodollars: settings.budget.dailyMicrodollars,
    prices: {
      inputMicrodollarsPerMTok: settings.budget.inputPriceMicrodollarsPerMTok,
      outputMicrodollarsPerMTok: settings.budget.outputPriceMicrodollarsPerMTok,
    },
  };
}

/**
 * The composition root's AI runtime choice (D-71, D-78). With AI enabled, a database and a provider the factory
 * accepts, it builds the provider (the SoC adapter or the marker fake), the real controller and `SchedulerLeases`.
 * Otherwise it keeps the D-52 controller stub and builds no provider. It logs nothing (D-56 is A-03's).
 */
export function createAiRuntime(deps: {
  readonly ai: AiConfig;
  readonly platform: AiRuntimePlatform | null;
  readonly fetch: FetchFunction;
}): AiRuntime {
  const disabled: AiRuntime = {
    controller: createDisabledAiExecutionController(),
    schedulerLeases: null,
    summaryLimits: null,
  };
  const { ai, platform } = deps;
  if (!ai.enabled || platform === null) {
    return disabled;
  }
  const provider = createLlmProvider({ settings: ai.value, appEnv: platform.appEnv, fetch: deps.fetch });
  if (!provider.ok) {
    return disabled;
  }
  const { database } = platform;
  return {
    controller: createAiExecutionController({
      database,
      sql: database,
      rateLimiter: platform.rateLimiter,
      socRequestKey: platform.rateLimitKeys.forEnvironment("soc_requests"),
      provider: provider.value,
      limits: aiExecutionLimits(ai.value),
      random: systemRandom,
      clock: monotonicClock,
      sleep,
    }),
    schedulerLeases: createSchedulerLeases({ database, sql: database }),
    summaryLimits: {
      sampleSize: ai.value.summaries.sampleSize,
      inputTokenLimit: ai.value.execution.inputTokenLimit,
    },
  };
}
