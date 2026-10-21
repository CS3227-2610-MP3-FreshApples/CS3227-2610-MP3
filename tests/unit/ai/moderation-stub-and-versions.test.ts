import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import {
  createDeferredModerationDispatcher,
  PROFANITY_POLICY_TEXT,
  PROFANITY_POLICY_VERSION,
  REVIEW_SCREENING_PROMPT_VERSION,
  UNREVIEWED_PROFANITY_POLICY_VERSION,
} from "../../../src/server/services/ai/moderation";
import type { ContentRevision, ReviewId } from "../../../src/server/shared";

const MODERATION_DIR = join(__dirname, "../../../src/server/services/ai/moderation");
const REPOSITORY_SOURCE = readFileSync(
  join(__dirname, "../../../src/server/repositories/ai/moderation-work-repository.ts"),
  "utf8",
);
const STUB_SOURCE = readFileSync(join(MODERATION_DIR, "deferred-dispatcher.ts"), "utf8");
const HEADER = STUB_SOURCE.slice(0, STUB_SOURCE.indexOf("const DEFERRED"));

describe("deferred moderation dispatcher stub (D-52, AM-15)", () => {
  it("returns deferred and never throws", async () => {
    const dispatcher = createDeferredModerationDispatcher();

    await expect(
      dispatcher.attemptAfterCommit("00000000-0000-4000-8000-000000000001" as ReviewId, 1 as ContentRevision),
    ).resolves.toBe("deferred");
  });

  it("takes no dependencies, so it cannot open a Tx, write rows or call a provider", () => {
    expect(createDeferredModerationDispatcher.length).toBe(0);
    const imports = [...STUB_SOURCE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports).toEqual(["./types"]);
  });

  it("names B#7 as its replacement and D-54 and D-56 as rules the real dispatcher must apply", () => {
    expect(HEADER).toMatch(/B#7/);
    expect(HEADER).toMatch(/D-54/);
    expect(HEADER).toMatch(/D-56/);
  });
});

describe("moderation versions (D-49)", () => {
  it("are the recorded initial values in <name>-v<integer> form", () => {
    expect(REVIEW_SCREENING_PROMPT_VERSION).toBe("review-screening-prompt-v1");
    expect(PROFANITY_POLICY_VERSION).toBe("profanity-policy-v1");
    expect(UNREVIEWED_PROFANITY_POLICY_VERSION).toBe("profanity-policy-v0");
    for (const version of [REVIEW_SCREENING_PROMPT_VERSION, PROFANITY_POLICY_VERSION]) {
      expect(version).toMatch(/^[a-z]+(?:-[a-z]+)*-v(?:0|[1-9][0-9]*)$/);
    }
  });

  it("ships the reviewed policy text beside its version, naming that version (D-17, D-99)", () => {
    expect(readdirSync(join(MODERATION_DIR, "policy")).sort()).toEqual(["text.ts", "version.ts"]);
    expect(PROFANITY_POLICY_TEXT).toContain(PROFANITY_POLICY_VERSION);
    expect(PROFANITY_POLICY_TEXT).toMatch(/English/);
  });

  it("defines everything AI-02 requires of the policy", () => {
    expect(PROFANITY_POLICY_TEXT).toMatch(/Obfuscated spellings/);
    expect(PROFANITY_POLICY_TEXT).toMatch(/Contextual quotations/);
    expect(PROFANITY_POLICY_TEXT).toMatch(/negative opinions of the film/);
    expect(PROFANITY_POLICY_TEXT).toMatch(/Languages/);
  });
});

describe("ModerationWork repository (D-58)", () => {
  it("never reads or locks a Movie or Review row; the caller holds the Review lock", () => {
    expect(REPOSITORY_SOURCE).not.toMatch(/app\.(?:review|movie)\b/);
  });
});
