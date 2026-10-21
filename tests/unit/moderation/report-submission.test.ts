import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createReportService,
  parseReportInput,
  type ReportReviewTarget,
} from "../../../src/server/services/moderation";
import type { ReportServiceDependencies } from "../../../src/server/services/moderation";
import type { RateLimitKey, RateLimiter } from "../../../src/server/services/rate-limit";
import type { AccountId, MovieId, ReportId, ReviewId, RowVersion, Tx } from "../../../src/server/shared";

const TX = {} as Tx;
const REPORTER_ID = "00000000-0000-0000-0000-000000000001" as AccountId;
const AUTHOR_ID = "00000000-0000-0000-0000-000000000002" as AccountId;
const REVIEW_ID = "00000000-0000-0000-0000-000000000003" as ReviewId;
const MOVIE_ID = "00000000-0000-0000-0000-000000000004" as MovieId;
const REPORT_ID = "00000000-0000-0000-0000-000000000005" as ReportId;

const target: ReportReviewTarget = {
  reviewId: REVIEW_ID,
  movieId: MOVIE_ID,
  movieTitle: "A Synthetic Movie",
  authorId: AUTHOR_ID,
  reviewVersion: 7 as RowVersion,
  rating: 8,
  body: "The review body is captured exactly at report submission.",
  deletedAt: null,
  hiddenAt: null,
  moderationState: "cleared",
  movieArchived: false,
};

function dependencies(overrides: Partial<ReportServiceDependencies> = {}): ReportServiceDependencies {
  const events: string[] = [];
  const rateLimiter: RateLimiter = {
    consume: vi.fn().mockResolvedValue({ allowed: true }),
    check: vi.fn(),
    purgeExpired: vi.fn(),
  };
  const deps: ReportServiceDependencies & { events: string[] } = {
    database: {
      withTransaction: vi.fn(<T>(work: (tx: Tx) => Promise<T>) => work(TX)),
      withTransactionResult: vi.fn(<T, E>(work: (tx: Tx) => Promise<{ ok: true; value: T } | { ok: false; error: E }>) => work(TX)),
    },
    accounts: { lockActiveUserShared: vi.fn().mockResolvedValue({ accountId: REPORTER_ID }) },
    movieLocks: { lockActiveMovieShared: vi.fn(async () => { events.push("movie"); return { ok: true as const, value: { movieId: MOVIE_ID } }; }) },
    reviews: {
      findForReport: vi.fn().mockResolvedValue(target),
      lockForReport: vi.fn(async () => { events.push("review"); return target; }),
    },
    reports: {
      insert: vi.fn().mockResolvedValue({
        id: REPORT_ID,
        reporterId: REPORTER_ID,
        reviewId: REVIEW_ID,
        category: "harassment",
        status: "open",
        createdAt: new Date("2026-10-21T00:00:00.000Z"),
      }),
    },
    rateLimiter,
    rateLimitKeys: { forAccount: vi.fn().mockReturnValue("report_create:reporter" as RateLimitKey) },
    ...overrides,
    events,
  } as ReportServiceDependencies & { events: string[] };
  return deps;
}

describe("report input", () => {
  it("accepts the report category and trims a 10–1,000 character explanation", () => {
    expect(parseReportInput({ category: "harassment", explanation: "  " + "a".repeat(10) + "  " })).toEqual({
      ok: true,
      value: { category: "harassment", explanation: "a".repeat(10) },
    });
  });

  it("rejects malformed evidence snapshots and unknown fields", async () => {
    const { parseEvidenceSnapshot } = await import("../../../src/server/services/moderation");
    expect(parseEvidenceSnapshot({ reviewId: "not-a-uuid", reviewVersion: 1, authorId: AUTHOR_ID, movieId: MOVIE_ID, movieTitle: "Movie", body: "A sufficiently long review body.", rating: 8 })).toEqual({ ok: false, error: { kind: "invalid" } });
    expect(parseEvidenceSnapshot({ reviewId: REVIEW_ID, reviewVersion: 1, authorId: AUTHOR_ID, movieId: MOVIE_ID, movieTitle: "Movie", body: "A sufficiently long review body.", rating: 8, extra: true })).toEqual({ ok: false, error: { kind: "invalid" } });
  });

  it.each([
    { category: "unknown", explanation: "valid explanation" },
    { category: "spam", explanation: "too short" },
    { category: "spam", explanation: "x".repeat(1_001) },
    { category: "spam", explanation: "valid explanation", targetUserId: AUTHOR_ID },
  ])("rejects invalid or client-controlled fields: %j", (input) => {
    expect(parseReportInput(input).ok).toBe(false);
  });
});

describe("report submission", () => {
  it("derives the target and stores an immutable evidence snapshot", async () => {
    const deps = dependencies();
    const service = createReportService(deps);

    await expect(service.submit(REPORTER_ID, REVIEW_ID, { category: "harassment", explanation: "A valid report explanation." })).resolves.toEqual({
      ok: true,
      value: {
        id: REPORT_ID,
        reviewId: REVIEW_ID,
        category: "harassment",
        status: "open",
        createdAt: new Date("2026-10-21T00:00:00.000Z"),
      },
    });

    expect(deps.reports.insert).toHaveBeenCalledWith(TX, expect.objectContaining({
      reporterId: REPORTER_ID,
      targetUserId: AUTHOR_ID,
      reviewId: REVIEW_ID,
      evidenceSnapshot: {
        reviewId: REVIEW_ID,
        reviewVersion: 7,
        authorId: AUTHOR_ID,
        movieId: MOVIE_ID,
        movieTitle: "A Synthetic Movie",
        body: target.body,
        rating: 8,
      },
    }));
    expect((deps as ReportServiceDependencies & { readonly events: readonly string[] }).events).toEqual(["movie", "review"]);
  });

  it("rejects self-reports without inserting a Report", async () => {
    const deps = dependencies({ reviews: {
      findForReport: vi.fn().mockResolvedValue({ ...target, authorId: REPORTER_ID }),
      lockForReport: vi.fn().mockResolvedValue({ ...target, authorId: REPORTER_ID }),
    } });
    const service = createReportService(deps);

    await expect(service.submit(REPORTER_ID, REVIEW_ID, { category: "spam", explanation: "A valid report explanation." })).resolves.toEqual({
      ok: false,
      error: { kind: "forbidden" },
    });
    expect(deps.reports.insert).not.toHaveBeenCalled();
  });

  it("maps the report uniqueness constraint to a conflict", async () => {
    const deps = dependencies({ reports: { insert: vi.fn().mockRejectedValue({ code: "23505" }) } });
    const service = createReportService(deps);

    await expect(service.submit(REPORTER_ID, REVIEW_ID, { category: "spam", explanation: "A valid report explanation." })).resolves.toEqual({
      ok: false,
      error: { kind: "conflict" },
    });
  });

  it("rejects a rate-limited submission before opening a transaction", async () => {
    const deps = dependencies({ rateLimiter: { consume: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 37 }), check: vi.fn(), purgeExpired: vi.fn() } });
    const service = createReportService(deps);

    await expect(service.submit(REPORTER_ID, REVIEW_ID, { category: "spam", explanation: "A valid report explanation." })).resolves.toEqual({
      ok: false,
      error: { kind: "rate_limited", retryAfterSeconds: 37 },
    });
    expect(deps.database.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { deletedAt: new Date("2026-10-21T00:00:00.000Z"), hiddenAt: null, moderationState: "cleared" as const },
    { deletedAt: null, hiddenAt: new Date("2026-10-21T00:00:00.000Z"), moderationState: "cleared" as const },
    { deletedAt: null, hiddenAt: null, moderationState: "pending" as const },
  ])("rejects a non-visible target safely: %j", async (visibility) => {
    const deps = dependencies({ reviews: { findForReport: vi.fn().mockResolvedValue(target), lockForReport: vi.fn().mockResolvedValue({ ...target, ...visibility }) } });
    const service = createReportService(deps);

    await expect(service.submit(REPORTER_ID, REVIEW_ID, { category: "spam", explanation: "A valid report explanation." })).resolves.toEqual({
      ok: false,
      error: { kind: "conflict" },
    });
    expect(deps.reports.insert).not.toHaveBeenCalled();
  });
});
