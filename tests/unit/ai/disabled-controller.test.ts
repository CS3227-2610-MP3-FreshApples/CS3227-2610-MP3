import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import {
  createDisabledAiExecutionController,
  type AiExecutionRequest,
} from "../../../src/server/services/ai/runtime";
import type {
  AccountId,
  ContentRevision,
  MovieId,
  ReviewId,
  ReviewsRevision,
  RowVersion,
} from "../../../src/server/shared";

const STUB_SOURCE = readFileSync(
  join(__dirname, "../../../src/server/services/ai/runtime/disabled-controller.ts"),
  "utf8",
);

function request(job: AiExecutionRequest<string>["job"]) {
  const validate = vi.fn<AiExecutionRequest<string>["validate"]>(() => ({ ok: true, value: "output" }));
  const publish = vi.fn<AiExecutionRequest<string>["publish"]>(async () => ({ ok: true, value: undefined }));
  const value: AiExecutionRequest<string> = {
    job,
    input: { messages: [{ role: "user", content: "text" }], estimatedInputTokens: 10, snapshot: {} },
    maxOutputTokens: 1_000,
    validate,
    publish,
  };
  return { value, validate, publish };
}

describe("disabled AI execution controller (D-52, AM-15)", () => {
  const jobs: AiExecutionRequest<string>["job"][] = [
    {
      type: "summary",
      movieId: "00000000-0000-4000-8000-000000000001" as MovieId,
      reviewsRevision: 3 as ReviewsRevision,
      promptVersion: "summary-prompt",
    },
    {
      type: "review_moderation",
      reviewId: "00000000-0000-4000-8000-000000000002" as ReviewId,
      captured: { contentRevision: 1 as ContentRevision, version: 1 as RowVersion },
      requesterId: "00000000-0000-4000-8000-000000000003" as AccountId,
      promptVersion: "review-screening-prompt-v1",
      policyVersion: "profanity-policy-v0",
    },
  ];

  it.each(jobs)("returns disabled for a $type job and never calls validate or publish", async (job) => {
    const { value, validate, publish } = request(job);

    await expect(createDisabledAiExecutionController().run(value)).resolves.toEqual({ kind: "disabled" });
    expect(validate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("takes no dependencies, so it cannot open a Tx, write rows or call a provider", () => {
    expect(createDisabledAiExecutionController.length).toBe(0);
    const imports = [...STUB_SOURCE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports).toEqual(["./types"]);
  });

  it("names B#5 as its replacement in the file header", () => {
    expect(STUB_SOURCE.slice(0, 400)).toMatch(/B#5/);
  });
});
