import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { FetchFunction } from "../../../src/server/adapters/soc-llm";
import type { AiConfig, AiProvider, AiSettings, AppEnv } from "../../../src/server/config";
import { createDatabase } from "../../../src/server/db";
import {
  createAiRuntime,
  type AiExecutionRequest,
  type AiRuntimePlatform,
} from "../../../src/server/services/ai/runtime";
import { createRateLimitKeys } from "../../../src/server/services/rate-limit";
import type { MovieId, ReviewsRevision } from "../../../src/server/shared";
import { createFailClosedRateLimiter } from "../../support/fakes/rate-limiter";

function settings(provider: AiProvider): AiSettings {
  return {
    provider,
    soc: { baseUrl: "https://fake-llm.invalid", apiKey: "synthetic-placeholder-key", model: "fake-model" },
    quotas: { requestsPerMinute: 30 },
    budget: { dailyMicrodollars: 1_000_000, inputPriceMicrodollarsPerMTok: 1, outputPriceMicrodollarsPerMTok: 1 },
    execution: {
      maxConcurrentRequests: 1,
      attemptTimeoutMs: 30_000,
      maxAttempts: 2,
      executionDeadlineMs: 75_000,
      inputTokenLimit: 8_000,
    },
    summaries: { sampleSize: 20, intervalDays: 1, maxMoviesPerRun: 1 },
    moderation: { maxExecutions: 3, recoveryMaxReviews: 1 },
  };
}

const enabled = (provider: AiProvider): AiConfig => ({ enabled: true, value: settings(provider) });
const DISABLED: AiConfig = { enabled: false, issues: [] };

// The pool connects lazily, so constructing it here opens no connection; nothing in these tests queries it.
function platform(appEnv: AppEnv): AiRuntimePlatform {
  return {
    database: createDatabase({ url: "postgresql://synthetic:synthetic@127.0.0.1:1/unused", caCert: null }),
    rateLimiter: createFailClosedRateLimiter(),
    rateLimitKeys: createRateLimitKeys({ secret: "synthetic-rate-limit-key-secret-0123456789" }),
    appEnv,
  };
}

function unusedFetch(): FetchFunction & { readonly calls: number } {
  let calls = 0;
  const fetch: FetchFunction = async () => {
    calls += 1;
    throw new Error("fetch must not be called while wiring");
  };
  return Object.defineProperty(fetch, "calls", { get: () => calls }) as FetchFunction & { readonly calls: number };
}

function request(maxOutputTokens: number): AiExecutionRequest<string> {
  return {
    job: {
      type: "summary",
      movieId: "00000000-0000-4000-8000-000000000001" as MovieId,
      reviewsRevision: 1 as ReviewsRevision,
      promptVersion: "summary-prompt",
    },
    input: { messages: [{ role: "user", content: "text" }], estimatedInputTokens: 1, snapshot: {} },
    maxOutputTokens,
    validate: () => ({ ok: true, value: "output" }),
    publish: async () => ({ ok: true, value: undefined }),
  };
}

/**
 * The D-52 stub resolves `disabled` for any request; the real controller throws for an invalid output cap before
 * any I/O (D-68). That difference identifies which one was wired without touching a database.
 */
async function expectStub(runtime: ReturnType<typeof createAiRuntime>): Promise<void> {
  await expect(runtime.controller.run(request(0))).resolves.toEqual({ kind: "disabled" });
  expect(runtime.schedulerLeases).toBeNull();
}

async function expectRealController(runtime: ReturnType<typeof createAiRuntime>): Promise<void> {
  await expect(runtime.controller.run(request(0))).rejects.toThrow();
  expect(runtime.schedulerLeases).not.toBeNull();
}

describe("createAiRuntime — composition-root wiring (D-71, D-78)", () => {
  it("keeps the D-52 stub and builds no provider when AI is disabled", async () => {
    const fetch = unusedFetch();

    await expectStub(createAiRuntime({ ai: DISABLED, platform: platform("production"), fetch }));
    expect(fetch.calls).toBe(0);
  });

  it("keeps the D-52 stub when AI is enabled but there is no database (D-78)", async () => {
    await expectStub(createAiRuntime({ ai: enabled("soc_llm"), platform: null, fetch: unusedFetch() }));
  });

  it("keeps the D-52 stub when the provider factory refuses the fake in production", async () => {
    await expectStub(createAiRuntime({ ai: enabled("fake"), platform: platform("production"), fetch: unusedFetch() }));
  });

  it("wires the real controller and SchedulerLeases with the SoC adapter when AI is enabled", async () => {
    const fetch = unusedFetch();

    await expectRealController(createAiRuntime({ ai: enabled("soc_llm"), platform: platform("production"), fetch }));
    expect(fetch.calls).toBe(0);
  });

  it.each(["local", "test", "development"] as const)(
    "wires the real controller with the marker fake in %s",
    async (appEnv) => {
      await expectRealController(createAiRuntime({ ai: enabled("fake"), platform: platform(appEnv), fetch: unusedFetch() }));
    },
  );
});
