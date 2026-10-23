import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { newAiJob } from "../../../../src/server/services/ai/runtime/job-record";
import type { AccountId, MovieId, ReviewsRevision } from "../../../../src/server/shared";

const MOVIE_ID = "20000000-0000-4000-8000-000000000041" as MovieId;
const ADMIN_ID = "10000000-0000-4000-8000-000000000041" as AccountId;
const descriptor = {
  type: "summary" as const,
  movieId: MOVIE_ID,
  reviewsRevision: 9 as ReviewsRevision,
  promptVersion: "summary-v1",
};

describe("manual summary AI job provenance", () => {
  it("keeps scheduler jobs scheduler-triggered with no requester", () => {
    expect(newAiJob(descriptor, [], {}, "model", new Date("2026-10-23T00:01:00Z"))).toMatchObject({
      type: "summary",
      trigger: "scheduler",
      requesterId: null,
    });
  });

  it("records an explicit Admin request with the authenticated requester", () => {
    expect(newAiJob(
      { ...descriptor, requesterId: ADMIN_ID },
      [],
      {},
      "model",
      new Date("2026-10-23T00:01:00Z"),
    )).toMatchObject({ type: "summary", trigger: "admin_request", requesterId: ADMIN_ID });
  });
});
