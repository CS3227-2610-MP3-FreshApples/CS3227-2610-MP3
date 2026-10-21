import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type {
  EligibleReviewRecord,
  NewReviewSummary,
  ReviewSummaryRepository,
} from "../../../../src/server/repositories/summary";
import type {
  AiExecutionController,
  AiExecutionOutcome,
  AiExecutionRequest,
} from "../../../../src/server/services/ai/runtime";
import {
  createSummaryGeneration,
  createSummaryPublisher,
  prepareSummaryInput,
  SUMMARY_PROMPT_VERSION,
  type SummaryInputPreparation,
  type SummaryLimits,
  type SummaryOutput,
  type SummaryPreparation,
  type SummaryPublisher,
} from "../../../../src/server/services/ai/summary";
import type { SummarySchedule } from "../../../../src/server/services/catalogue";
import type {
  AiJobId,
  ContentRevision,
  MovieId,
  ReviewId,
  ReviewsRevision,
  RowVersion,
  Tx,
} from "../../../../src/server/shared";
import { createFakeCatalogueCore, type FakeCatalogueCore } from "../../../support/fakes/catalogue-core";

const MOVIE_ID = "20000000-0000-4000-8000-000000000003" as MovieId;
const JOB_ID = "40000000-0000-4000-8000-000000000001" as AiJobId;
const REVISION = 5 as ReviewsRevision;
const SEED = Buffer.alloc(32, 0x11);
const LIMITS: SummaryLimits = { sampleSize: 20, inputTokenLimit: 8_000 };
const TX = {} as Tx;

const OUTPUT: SummaryOutput = {
  overall: "Reviewers are divided.",
  strengths: [{ text: "Praised acting.", sources: ["R1", "R2"] }],
  criticisms: [{ text: "Slow middle.", sources: ["R3"] }],
  mixedOpinions: [],
};

function reviews(count: number): EligibleReviewRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` as ReviewId,
    version: 2 as RowVersion,
    contentRevision: 1 as ContentRevision,
    rating: 7,
    body: `Synthetic opinion ${index + 1}.`,
  }));
}

type Ready = Extract<SummaryPreparation, { readonly kind: "ready" }>;

function readyPreparation(count = 4): Ready {
  const result = prepareSummaryInput(
    MOVIE_ID,
    { reviewsRevision: REVISION, hasCurrentSummary: false, reviews: reviews(count) },
    LIMITS,
    SEED,
  );
  if (result.kind !== "ready") {
    throw new Error(`expected ready, got ${result.kind}`);
  }
  return result;
}

function preparation(result: SummaryPreparation): SummaryInputPreparation {
  return { prepare: vi.fn(() => Promise.resolve(result)) };
}

/** A controller that records the request and returns `outcome`. */
function controller(outcome: AiExecutionOutcome) {
  const requests: AiExecutionRequest<SummaryOutput>[] = [];
  const stub: AiExecutionController = {
    async run(request) {
      requests.push(request as unknown as AiExecutionRequest<SummaryOutput>);
      return outcome;
    },
  };
  return { stub, requests };
}

const unusedPublisher: SummaryPublisher = {
  publish: () => Promise.reject(new Error("publish must not be called")),
};

describe("summary generation outcomes before K10 (D-89, AT-07)", () => {
  it.each<SummaryPreparation>([
    { kind: "unavailable" },
    { kind: "insufficient_reviews", eligibleCount: 2 },
    { kind: "current" },
    { kind: "input_unfit" },
  ])("returns $kind without calling K10", async (prepared) => {
    const { stub, requests } = controller({ kind: "disabled" });
    const generation = createSummaryGeneration({
      preparation: preparation(prepared),
      controller: stub,
      publisher: unusedPublisher,
    });

    await expect(generation.generate(MOVIE_ID)).resolves.toEqual(prepared);
    expect(requests).toHaveLength(0);
  });
});

describe("summary generation request (AM-23)", () => {
  it("sends the summary descriptor, the prepared input and the 1,200-token cap in one K10 call", async () => {
    const prepared = readyPreparation();
    const { stub, requests } = controller({ kind: "published", jobId: JOB_ID });
    const generation = createSummaryGeneration({
      preparation: preparation(prepared),
      controller: stub,
      publisher: unusedPublisher,
    });

    await generation.generate(MOVIE_ID);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      job: { type: "summary", movieId: MOVIE_ID, reviewsRevision: REVISION, promptVersion: "review-summary-prompt-v1" },
      input: prepared.input,
      maxOutputTokens: 1_200,
    });
  });

  it("validates against the included labels only", async () => {
    const prepared = readyPreparation(3);
    const { stub, requests } = controller({ kind: "disabled" });
    await createSummaryGeneration({ preparation: preparation(prepared), controller: stub, publisher: unusedPublisher })
      .generate(MOVIE_ID);
    const validate = requests[0]!.validate;

    expect(validate(JSON.stringify(OUTPUT))).toEqual({ ok: true, value: OUTPUT });
    const invented = { ...OUTPUT, mixedOpinions: [{ text: "Split.", sources: ["R4"] }] };
    expect(validate(JSON.stringify(invented))).toEqual({ ok: false, error: { kind: "invalid_output" } });
    expect(validate("not json")).toEqual({ ok: false, error: { kind: "invalid_output" } });
  });

  it("publishes the captured revision, eligible count and included sample with the validated output", async () => {
    const prepared = readyPreparation(25);
    const { stub, requests } = controller({ kind: "disabled" });
    const publisher: SummaryPublisher = { publish: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })) };
    await createSummaryGeneration({ preparation: preparation(prepared), controller: stub, publisher }).generate(MOVIE_ID);

    await requests[0]!.publish(TX, OUTPUT, { jobId: JOB_ID });

    expect(publisher.publish).toHaveBeenCalledExactlyOnceWith(
      TX,
      { movieId: MOVIE_ID, reviewsRevision: REVISION, eligibleCount: 25, sample: prepared.sample },
      OUTPUT,
      JOB_ID,
    );
  });

  it.each<AiExecutionOutcome>([
    { kind: "published", jobId: JOB_ID },
    { kind: "disabled" },
    { kind: "deferred", retryAfterSeconds: 30 },
    { kind: "deferred", retryAfterSeconds: null },
    { kind: "duplicate", jobId: JOB_ID },
    { kind: "input_too_large" },
    { kind: "failed", jobId: JOB_ID, cause: "transient" },
    { kind: "failed", jobId: JOB_ID, cause: "invalid_output" },
    { kind: "failed", jobId: JOB_ID, cause: "provider_rejected" },
    { kind: "stale", jobId: JOB_ID },
  ])("returns the K10 outcome %o unchanged (D-89)", async (outcome) => {
    const { stub } = controller(outcome);
    const generation = createSummaryGeneration({
      preparation: preparation(readyPreparation()),
      controller: stub,
      publisher: unusedPublisher,
    });

    await expect(generation.generate(MOVIE_ID)).resolves.toEqual(outcome);
  });

  it("propagates an infrastructure fault in the D-86 read (D-94 counts it as failed)", async () => {
    const { stub, requests } = controller({ kind: "disabled" });
    const generation = createSummaryGeneration({
      preparation: { prepare: () => Promise.reject(new Error("read failed")) },
      controller: stub,
      publisher: unusedPublisher,
    });

    await expect(generation.generate(MOVIE_ID)).rejects.toThrow("read failed");
    expect(requests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The publish callback against the K7 fake. Rollback itself needs PostgreSQL (integration tests).

interface Harness {
  readonly core: FakeCatalogueCore;
  readonly publisher: SummaryPublisher;
  readonly inserted: NewReviewSummary[];
  readonly calls: string[];
  readonly existsCurrent: ReturnType<typeof vi.fn<ReviewSummaryRepository["existsCurrent"]>>;
}

function harness(options: { readonly currentExists?: boolean; readonly schedule?: Partial<SummarySchedule> } = {}): Harness {
  const core = createFakeCatalogueCore();
  const inserted: NewReviewSummary[] = [];
  const calls: string[] = [];
  const existsCurrent = vi.fn<ReviewSummaryRepository["existsCurrent"]>(async () => {
    calls.push("existsCurrent");
    return options.currentExists ?? false;
  });
  const summaries: ReviewSummaryRepository = {
    existsCurrent,
    insert: async (_tx, summary) => {
      calls.push("insert");
      inserted.push(summary);
    },
  };
  const locks = core.locks;
  const publisher = createSummaryPublisher({
    movieLocks: {
      ...locks,
      lockActiveMovieForUpdate: (tx, movieId) => {
        calls.push("lockActiveMovieForUpdate");
        return locks.lockActiveMovieForUpdate(tx, movieId);
      },
    },
    schedule: {
      ...core.schedule,
      recordSummaryPublished: (tx, movie, published) => {
        calls.push("recordSummaryPublished");
        return (options.schedule?.recordSummaryPublished ?? core.schedule.recordSummaryPublished)(tx, movie, published);
      },
    },
    summaries,
  });
  return { core, publisher, inserted, calls, existsCurrent };
}

function publication() {
  const prepared = readyPreparation(4);
  return { movieId: MOVIE_ID, reviewsRevision: REVISION, eligibleCount: 4, sample: prepared.sample };
}

const STALE = { ok: false, error: { kind: "stale" } };

describe("summary publish callback (contracts §3.3, AM-23, AM-25)", () => {
  it("locks the Movie, checks for a current summary, inserts, then records the publication, in that order", async () => {
    const h = harness();
    h.core.seedMovie(MOVIE_ID, { reviewsRevision: REVISION, summaryPendingSince: new Date("2026-01-01T00:00:00Z") });
    const input = publication();

    await expect(h.publisher.publish(TX, input, OUTPUT, JOB_ID)).resolves.toEqual({
      ok: true,
      value: undefined,
    });

    expect(h.calls).toEqual(["lockActiveMovieForUpdate", "existsCurrent", "insert", "recordSummaryPublished"]);
    expect(h.existsCurrent).toHaveBeenCalledExactlyOnceWith(TX, MOVIE_ID, REVISION, SUMMARY_PROMPT_VERSION);
    expect(h.inserted).toEqual([
      {
        jobId: JOB_ID,
        movieId: MOVIE_ID,
        reviewsRevision: REVISION,
        sampleJson: JSON.stringify(input.sample),
        eligibleCount: 4,
        outputJson: JSON.stringify(OUTPUT),
      },
    ]);
    expect(h.core.stored(MOVIE_ID)).toMatchObject({ summaryPendingSince: null, summaryLastSuccessAt: expect.any(Date) });
  });

  it("stores the sample with no Review text", async () => {
    const h = harness();
    h.core.seedMovie(MOVIE_ID, { reviewsRevision: REVISION });

    await h.publisher.publish(TX, publication(), OUTPUT, JOB_ID);

    expect(h.inserted[0]?.sampleJson).not.toContain("Synthetic opinion");
    expect(JSON.parse(h.inserted[0]!.sampleJson)).toMatchObject({ algorithm: "summary-sample-v1", sampledCount: 4 });
  });

  it("returns stale for a missing Movie and writes nothing", async () => {
    const h = harness();

    await expect(h.publisher.publish(TX, publication(), OUTPUT, JOB_ID)).resolves.toEqual(STALE);
    expect(h.calls).toEqual(["lockActiveMovieForUpdate"]);
  });

  it("returns stale for an archived Movie and writes nothing (archive race)", async () => {
    const h = harness();
    h.core.seedMovie(MOVIE_ID, { reviewsRevision: REVISION, archived: true });

    await expect(h.publisher.publish(TX, publication(), OUTPUT, JOB_ID)).resolves.toEqual(STALE);
    expect(h.calls).toEqual(["lockActiveMovieForUpdate"]);
  });

  it.each([
    ["advanced", REVISION + 1],
    ["behind", REVISION - 1],
  ])("returns stale when the revision is %s and writes nothing (AT-08)", async (_label, revision) => {
    const h = harness();
    const pendingSince = new Date("2026-01-01T00:00:00Z");
    h.core.seedMovie(MOVIE_ID, { reviewsRevision: revision, summaryPendingSince: pendingSince });

    await expect(h.publisher.publish(TX, publication(), OUTPUT, JOB_ID)).resolves.toEqual(STALE);
    expect(h.calls).toEqual(["lockActiveMovieForUpdate"]);
    expect(h.core.stored(MOVIE_ID)).toMatchObject({ summaryPendingSince: pendingSince, summaryLastSuccessAt: null });
  });

  it("returns stale when a current summary already exists and inserts nothing (D-93 duplicate guard)", async () => {
    const h = harness({ currentExists: true });
    h.core.seedMovie(MOVIE_ID, { reviewsRevision: REVISION });

    await expect(h.publisher.publish(TX, publication(), OUTPUT, JOB_ID)).resolves.toEqual(STALE);
    expect(h.calls).toEqual(["lockActiveMovieForUpdate", "existsCurrent"]);
  });

  it("passes K7's stale through, for K10 to roll the insert back", async () => {
    const h = harness({ schedule: { recordSummaryPublished: async () => ({ ok: false, error: { kind: "stale" } }) } });
    h.core.seedMovie(MOVIE_ID, { reviewsRevision: REVISION });

    await expect(h.publisher.publish(TX, publication(), OUTPUT, JOB_ID)).resolves.toEqual(STALE);
    expect(h.calls).toEqual(["lockActiveMovieForUpdate", "existsCurrent", "insert", "recordSummaryPublished"]);
  });

  it("propagates a storage fault, which K10 turns into failed storage_failed (D-75)", async () => {
    const h = harness();
    h.core.seedMovie(MOVIE_ID, { reviewsRevision: REVISION });
    const failing = createSummaryPublisher({
      movieLocks: h.core.locks,
      schedule: h.core.schedule,
      summaries: { existsCurrent: async () => false, insert: () => Promise.reject(new Error("insert failed")) },
    });

    await expect(failing.publish(TX, publication(), OUTPUT, JOB_ID)).rejects.toThrow("insert failed");
    expect(h.core.stored(MOVIE_ID).summaryLastSuccessAt).toBeNull();
  });
});
