import { describe, expect, it } from "vitest";

import type { LlmMessage, LlmProvider } from "../../../src/server/adapters/soc-llm";

export interface LlmProviderHarness {
  /** A provider built with `modelId` whose next call succeeds. */
  succeeding(modelId: string): LlmProvider;
  /** A provider built with `modelId` whose next call stays pending until its signal aborts. */
  hanging(modelId: string): LlmProvider;
}

const MESSAGES: readonly LlmMessage[] = [
  { role: "system", content: "Follow the task instructions." },
  { role: "user", content: "Untrusted review text." },
];

/**
 * K10 provider contract suite (workflow/contracts.md §13, §22 AM-15; D-52, D-78). Runs against the scripted
 * fake, the marker fake and the SoC adapter with a stub `fetch`, so each reports the constructed model and
 * turns an abort into `timeout` without rejecting.
 */
export function describeLlmProviderContract(label: string, harness: LlmProviderHarness): void {
  describe(`LlmProvider contract — ${label}`, () => {
    it("reports the model it was constructed with", () => {
      expect(harness.succeeding("model-a").modelId).toBe("model-a");
      expect(harness.succeeding("model-b").modelId).toBe("model-b");
    });

    it("returns a success with content and usage that is known or null", async () => {
      const result = await harness
        .succeeding("model-a")
        .complete({ messages: MESSAGES, maxOutputTokens: 1_000, signal: new AbortController().signal });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.value.content).toBe("string");
        expect(result.value.usage === null || typeof result.value.usage.inputTokens === "number").toBe(true);
      }
    });

    it("resolves an already-aborted call with timeout", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        harness.succeeding("model-a").complete({ messages: MESSAGES, maxOutputTokens: 1_000, signal: controller.signal }),
      ).resolves.toEqual({ ok: false, error: { kind: "timeout" } });
    });

    it("resolves a pending call with timeout when its signal aborts", async () => {
      const controller = new AbortController();
      const pending = harness
        .hanging("model-a")
        .complete({ messages: MESSAGES, maxOutputTokens: 1_000, signal: controller.signal });
      controller.abort();

      await expect(pending).resolves.toEqual({ ok: false, error: { kind: "timeout" } });
    });
  });
}
