import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { ModerationJobRecord } from "../../../../src/server/repositories/ai";
import { projectModerationJob } from "../../../../src/server/services/ai/moderation";
import type { AiJobId, ReviewId } from "../../../../src/server/shared";

// The D-102 projection. PostgreSQL and route behaviour are in tests/integration/api/ai/job-status.test.ts.

const RECORD: ModerationJobRecord = {
  id: "40000000-0000-4000-8000-000000000401" as AiJobId,
  reviewId: "30000000-0000-4000-8000-000000000401" as ReviewId,
  status: "succeeded",
  retryAfterSeconds: null,
  assessment: "no_profanity_detected",
  errorCode: null,
  createdAt: new Date("2026-10-21T01:02:03.004Z"),
  updatedAt: new Date("2026-10-21T01:02:05.000Z"),
};

describe("projectModerationJob (D-102)", () => {
  it("returns exactly the safe fields, with ISO 8601 UTC timestamps", () => {
    expect(projectModerationJob(RECORD)).toEqual({
      id: RECORD.id,
      reviewId: RECORD.reviewId,
      state: "succeeded",
      retryAfterSeconds: null,
      result: { assessment: "no_profanity_detected" },
      errorCode: null,
      createdAt: "2026-10-21T01:02:03.004Z",
      updatedAt: "2026-10-21T01:02:05.000Z",
    });
  });

  it("never exposes a stored assessment outside the AI-02 enum", () => {
    expect(projectModerationJob({ ...RECORD, assessment: "<script>" }).result).toBeNull();
  });

  it("gives no result without an assessment", () => {
    expect(projectModerationJob({ ...RECORD, status: "failed", assessment: null, errorCode: "invalid_output" })).toMatchObject({
      result: null,
      errorCode: "invalid_output",
    });
  });
});
