import "server-only";

import { z } from "zod";

import type { AccountId, MovieId, ReportCategory, ReportId, ReportStatus, ReviewId, RowVersion, Result } from "../../shared";

export interface EvidenceSnapshot {
  readonly reviewId: ReviewId;
  readonly reviewVersion: RowVersion;
  readonly authorId: AccountId;
  readonly movieId: MovieId;
  readonly movieTitle: string;
  readonly body: string;
  readonly rating: number;
}

export interface ReportReceipt {
  readonly id: ReportId;
  readonly reviewId: ReviewId;
  readonly category: ReportCategory;
  readonly status: ReportStatus;
  readonly createdAt: Date;
  readonly disposition?: "accepted" | "dismissed";
}

function codePoints(value: string): number { return Array.from(value).length; }
const boundedText = (min: number, max: number) => z.string().refine((value) => codePoints(value) >= min && codePoints(value) <= max);
const evidenceSnapshotSchema = z.strictObject({
  reviewId: z.uuid(),
  reviewVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  authorId: z.uuid(),
  movieId: z.uuid(),
  movieTitle: boundedText(1, 200),
  body: boundedText(10, 2_000),
  rating: z.number().int().min(1).max(10),
});

export function parseEvidenceSnapshot(stored: unknown): Result<EvidenceSnapshot, { readonly kind: "invalid" }> {
  const parsed = evidenceSnapshotSchema.safeParse(stored);
  return parsed.success ? { ok: true, value: parsed.data as unknown as EvidenceSnapshot } : { ok: false, error: { kind: "invalid" } };
}
