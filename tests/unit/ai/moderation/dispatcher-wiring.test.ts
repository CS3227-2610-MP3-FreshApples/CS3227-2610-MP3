import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import {
  failureBackoffSeconds,
  logUnreviewedPolicyIssue,
  MODERATION_CLAIM_SECONDS,
  PROFANITY_POLICY_VERSION,
  requiresDispatcherStub,
  UNREVIEWED_PROFANITY_POLICY_VERSION,
} from "../../../../src/server/services/ai/moderation";

// D-56 wiring, D-101 timings and the AI-02 containment rule. PostgreSQL behaviour is in
// tests/integration/ai/moderation/.

const ROOT = join(__dirname, "../../../..");
const MODERATION_DIR = join(ROOT, "src/server/services/ai/moderation");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function importsOf(path: string): string[] {
  return [...readFileSync(path, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dispatcher choice (D-56)", () => {
  it("wires the stub only for soc_llm under the unreviewed policy", () => {
    expect(requiresDispatcherStub("soc_llm", UNREVIEWED_PROFANITY_POLICY_VERSION)).toBe(true);
    expect(requiresDispatcherStub("soc_llm", PROFANITY_POLICY_VERSION)).toBe(false);
    expect(requiresDispatcherStub("fake", UNREVIEWED_PROFANITY_POLICY_VERSION)).toBe(false);
    expect(requiresDispatcherStub("fake", PROFANITY_POLICY_VERSION)).toBe(false);
  });

  it("wires the real dispatcher with soc_llm for the shipped, reviewed policy (D-99)", () => {
    expect(PROFANITY_POLICY_VERSION).not.toBe(UNREVIEWED_PROFANITY_POLICY_VERSION);
    expect(requiresDispatcherStub("soc_llm", PROFANITY_POLICY_VERSION)).toBe(false);
  });

  it("logs one configuration issue naming AI_PROVIDER and no value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    logUnreviewedPolicyIssue();

    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(warn.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(line).toEqual({ event: "config.issue", variable: "AI_PROVIDER", message: expect.any(String) });
    expect(line.message).not.toMatch(/https?:|sk-|key=/i);
  });

  it("never throws from the log line", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("console unavailable");
    });

    expect(() => logUnreviewedPolicyIssue()).not.toThrow();
  });

  it("is chosen in the composition root with named constructors, not a flag (contracts §1 rule 2)", () => {
    const composition = readFileSync(join(ROOT, "src/server/composition.ts"), "utf8");

    expect(composition).toMatch(/requiresDispatcherStub\(config\.ai\.value\.provider, PROFANITY_POLICY_VERSION\)/);
    expect(composition).toMatch(/createModerationDispatcher\(/);
    expect(composition).toMatch(/createDeferredModerationDispatcher\(\)/);
  });
});

describe("timings (D-101)", () => {
  it("claims for the routes' 120-second maxDuration", () => {
    expect(MODERATION_CLAIM_SECONDS).toBe(120);
    for (const route of ["src/app/api/v1/movies/[id]/reviews/route.ts", "src/app/api/v1/reviews/[id]/route.ts"]) {
      expect(readFileSync(join(ROOT, route), "utf8")).toMatch(/export const maxDuration = 120;/);
    }
  });

  it("backs off 15 minutes × 4^(n − 1), at most 1 day", () => {
    expect([1, 2, 3, 4, 5, 6].map(failureBackoffSeconds)).toEqual([900, 3_600, 14_400, 57_600, 86_400, 86_400]);
  });
});

describe("containment (AI-02, D-101)", () => {
  const files = sourceFiles(MODERATION_DIR);

  it("imports no report, strike, moderation-decision, identity or account-status module", () => {
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        expect(specifier, file).not.toMatch(/report|strike|decision|identity|account-status|account/i);
      }
    }
  });

  it("never imports the LLM adapter directly (AM-18)", () => {
    for (const file of files) {
      expect(importsOf(file).some((specifier) => specifier.includes("adapters")), file).toBe(false);
    }
  });

  it("writes no SQL itself; repositories own every statement", () => {
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\b(?:INSERT INTO|UPDATE app\.|DELETE FROM)\b/);
    }
  });
});
