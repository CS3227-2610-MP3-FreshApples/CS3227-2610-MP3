import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { ContentRevision, ReviewId, Tx } from "../../../src/server/shared";
import { describeModerationWorkQueueContract } from "../../support/contracts/moderation-work-queue.contract";
import { createFakeModerationDispatcher, createFakeModerationWorkQueue } from "../../support/fakes/moderation-work";

// The fake has no transactions; rollback and racing clients use PostgreSQL (D-10).
const TX = {} as Tx;

function newReviewId(): ReviewId {
  return randomUUID() as ReviewId;
}

describeModerationWorkQueueContract("in-memory fake (seeded Reviews)", async () => {
  const fake = createFakeModerationWorkQueue();
  return {
    queue: fake.queue,
    seedReview: async () => {
      const reviewId = newReviewId();
      fake.seedReview(reviewId);
      return reviewId;
    },
    missingReviewId: newReviewId,
    seedWork: async (reviewId, seed) => fake.seedWork(reviewId, seed),
    inReviewLockedTx: (_reviewId, work) => work(TX),
    storedWork: async (reviewId) => fake.storedWork(reviewId),
  };
});

describe("fake ModerationWork queue — fails closed", () => {
  it("throws from enqueue for a Review seeded on another fake", async () => {
    const seeded = createFakeModerationWorkQueue();
    const other = createFakeModerationWorkQueue();
    const reviewId = newReviewId();
    seeded.seedReview(reviewId);

    await expect(other.queue.enqueue(TX, reviewId, 1 as ContentRevision)).rejects.toThrow("unknown review");
  });

  it("throws when seeding work for an unseeded Review", () => {
    expect(() =>
      createFakeModerationWorkQueue().seedWork(newReviewId(), { contentRevision: 1, status: "pending" }),
    ).toThrow("not seeded");
  });
});

describe("fake ModerationWork queue — recording", () => {
  it("records enqueue and cancel calls in call order, including an enqueue that threw", async () => {
    const fake = createFakeModerationWorkQueue();
    const reviewId = newReviewId();
    const missing = newReviewId();
    fake.seedReview(reviewId);

    await fake.queue.enqueue(TX, reviewId, 1 as ContentRevision);
    await expect(fake.queue.enqueue(TX, missing, 2 as ContentRevision)).rejects.toThrow();
    await fake.queue.cancelForDeletedReview(TX, reviewId);
    await fake.queue.enqueue(TX, reviewId, 3 as ContentRevision);

    expect(fake.enqueueCalls).toEqual([
      { reviewId, contentRevision: 1 },
      { reviewId: missing, contentRevision: 2 },
      { reviewId, contentRevision: 3 },
    ]);
    expect(fake.cancelCalls).toEqual([reviewId]);
  });
});

describe("fake ModerationDispatcher", () => {
  it("returns deferred for every attempt and records the calls", async () => {
    const dispatcher = createFakeModerationDispatcher();
    const first = newReviewId();
    const second = newReviewId();

    expect(await dispatcher.attemptAfterCommit(first, 1 as ContentRevision)).toBe("deferred");
    expect(await dispatcher.attemptAfterCommit(second, 4 as ContentRevision)).toBe("deferred");

    expect(dispatcher.attemptCalls).toEqual([
      { reviewId: first, contentRevision: 1 },
      { reviewId: second, contentRevision: 4 },
    ]);
  });
});
