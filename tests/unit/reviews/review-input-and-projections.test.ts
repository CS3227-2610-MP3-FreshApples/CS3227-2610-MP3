import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createReviewRepository, type ReviewRow } from "../../../src/server/repositories/reviews";
import {
  parseReviewCreateInput,
  parseReviewPatchInput,
  projectOwnReview,
  projectPublicReview,
  type ReviewRecord,
} from "../../../src/server/services/reviews";
import type { AccountId, ContentRevision, MovieId, ReviewId, RowVersion, Tx } from "../../../src/server/shared";

const TX = {} as Tx;
const REVIEW_ID = "00000000-0000-0000-0000-000000000001" as ReviewId;
const MOVIE_ID = "00000000-0000-0000-0000-000000000002" as MovieId;
const AUTHOR_ID = "00000000-0000-0000-0000-000000000003" as AccountId;
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
const UPDATED_AT = new Date("2026-01-02T00:00:00.000Z");

const RECORD: ReviewRecord = {
  id: REVIEW_ID,
  movieId: MOVIE_ID,
  authorId: AUTHOR_ID,
  authorDisplayName: "Synthetic Reviewer",
  rating: 8,
  body: "A useful review body.",
  deletedAt: null,
  hiddenAt: null,
  moderationState: "cleared",
  contentRevision: 1 as ContentRevision,
  clearanceSource: "ai",
  version: 2 as RowVersion,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

describe("Review mutation input", () => {
  it("trims the body and accepts the inclusive rating and body boundaries", () => {
    expect(parseReviewCreateInput({ rating: 1, body: ` ${"a".repeat(10)} ` })).toEqual({
      ok: true,
      value: { rating: 1, body: "a".repeat(10) },
    });
    expect(parseReviewCreateInput({ rating: 10, body: ` ${"😀".repeat(2_000)} ` }).ok).toBe(true);
  });

  it.each([
    { rating: 0, body: "valid body" },
    { rating: 1.5, body: "valid body" },
    { rating: 11, body: "valid body" },
    { rating: 5, body: "too short" },
    { rating: 5, body: "x".repeat(2_001) },
    { rating: 5, body: "          " },
    { rating: 5, body: "valid body", clearanceSource: "admin" },
  ])("rejects invalid or client-controlled review fields: %j", (input) => {
    expect(parseReviewCreateInput(input).ok).toBe(false);
  });

  it("requires a nonempty strict patch and trims supplied values", () => {
    expect(parseReviewPatchInput({ body: " updated body " })).toEqual({ ok: true, value: { body: "updated body" } });
    expect(parseReviewPatchInput({}).ok).toBe(false);
    expect(parseReviewPatchInput({ moderationState: "cleared" }).ok).toBe(false);
  });
});

describe("Review safe projections", () => {
  it("matches the public projection and excludes private review/account fields", () => {
    expect(projectPublicReview(RECORD)).toEqual({
      id: REVIEW_ID,
      movieId: MOVIE_ID,
      author: { id: AUTHOR_ID, displayName: "Synthetic Reviewer" },
      rating: 8,
      body: "A useful review body.",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
    expect(projectPublicReview(RECORD)).not.toHaveProperty("clearanceSource");
    expect(projectPublicReview(RECORD)).not.toHaveProperty("author.email");
  });

  it("adds only safe moderation state to the owning User projection", () => {
    expect(projectOwnReview(RECORD)).toEqual({
      ...projectPublicReview(RECORD),
      moderationState: "cleared",
      version: RECORD.version,
    });
    expect(projectOwnReview(RECORD)).not.toHaveProperty("hiddenAt");
    expect(projectOwnReview(RECORD)).not.toHaveProperty("deletedAt");
  });
});

describe("Review repository mapping", () => {
  it("maps a database Review row without leaking storage names", async () => {
    const row: ReviewRow = {
      id: REVIEW_ID,
      movie_id: MOVIE_ID,
      author_id: AUTHOR_ID,
      author_display_name: "Synthetic Reviewer",
      rating: 8,
      body: "A useful review body.",
      deleted_at: null,
      hidden_at: null,
      moderation_state: "cleared",
      content_revision: 1 as ContentRevision,
      clearance_source: "ai",
      version: 2 as RowVersion,
      created_at: CREATED_AT,
      updated_at: UPDATED_AT,
    };
    const query = vi.fn().mockResolvedValue([row]);
    const repository = createReviewRepository({ sql: { query } });

    await expect(repository.findById(TX, REVIEW_ID)).resolves.toEqual(RECORD);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[2]).toEqual([REVIEW_ID]);
  });
});
