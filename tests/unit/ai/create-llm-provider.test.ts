import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { createLlmProvider, type FetchFunction } from "../../../src/server/adapters/soc-llm";
import { MARKER_FAKE_CLEAN_OUTPUT } from "../../../src/server/adapters/soc-llm/marker-fake-provider";
import type { AiProvider, AiSettings, AppEnv } from "../../../src/server/config";

function settings(provider: AiProvider): AiSettings {
  return {
    provider,
    soc: { baseUrl: "https://fake-llm.invalid", apiKey: "synthetic-placeholder-key", model: "fake-model" },
    quotas: { requestsPerMinute: 90 },
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

function recordingFetch(): FetchFunction & { readonly urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchFunction = async (url) => {
    urls.push(url);
    return new Response(
      JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "from soc" } }] }),
      { status: 200 },
    );
  };
  return Object.assign(fetch, { urls });
}

const CLEAN_REQUEST = {
  messages: [{ role: "user", content: "[fake-llm:clean]" }] as const,
  maxOutputTokens: 1_000,
  signal: new AbortController().signal,
};

describe("createLlmProvider (D-57, D-71)", () => {
  it.each(["local", "test", "development", "production"] as const)(
    "builds the SoC adapter for soc_llm with the given fetch (APP_ENV %s)",
    async (appEnv) => {
      const fetch = recordingFetch();
      const result = createLlmProvider({ settings: settings("soc_llm"), appEnv, fetch });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.modelId).toBe("fake-model");
      await expect(result.value.complete(CLEAN_REQUEST)).resolves.toEqual({
        ok: true,
        value: { content: "from soc", usage: null },
      });
      expect(fetch.urls).toEqual(["https://fake-llm.invalid/v1/chat/completions"]);
    },
  );

  it.each(["local", "test", "development"] as const)("builds the marker fake for fake in %s", async (appEnv) => {
    const fetch = recordingFetch();
    const result = createLlmProvider({ settings: settings("fake"), appEnv, fetch });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.modelId).toBe("fake-model");
    await expect(result.value.complete(CLEAN_REQUEST)).resolves.toMatchObject({
      ok: true,
      value: { content: MARKER_FAKE_CLEAN_OUTPUT },
    });
    // The marker fake, not the scripted fake: no marker fails closed, and it never touches the network.
    await expect(
      result.value.complete({ ...CLEAN_REQUEST, messages: [{ role: "user", content: "plain" }] }),
    ).resolves.toEqual({ ok: false, error: { kind: "unavailable" } });
    expect(fetch.urls).toEqual([]);
  });

  it("refuses fake in production", () => {
    const fetch = recordingFetch();

    expect(createLlmProvider({ settings: settings("fake"), appEnv: "production", fetch })).toEqual({
      ok: false,
      error: { kind: "fake_not_permitted" },
    });
  });

  it("refuses fake for an APP_ENV outside the allowed set", () => {
    const fetch = recordingFetch();

    expect(createLlmProvider({ settings: settings("fake"), appEnv: "staging" as AppEnv, fetch })).toEqual({
      ok: false,
      error: { kind: "fake_not_permitted" },
    });
  });
});
