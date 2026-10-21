import "server-only";

import type { Database } from "../../db";
import type { ReportRepository } from "../../repositories/moderation/report-repository";
import type { AccountId, Result, ReviewId, Tx } from "../../shared";
import { TransactionConflict } from "../../shared";
import type { MovieLocks } from "../catalogue";
import type { RateLimitKeys, RateLimiter } from "../rate-limit";
import { RATE_LIMIT_POLICIES } from "../rate-limit";
import { type ReportInput } from "./report-input";
import { type ReportReceipt } from "./report-evidence";

export type ReportSubmissionRejection =
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict" }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number };

export interface ReportService {
  submit(reporterId: AccountId, reviewId: ReviewId, input: ReportInput): Promise<Result<ReportReceipt, ReportSubmissionRejection>>;
}

export interface ReportServiceDependencies {
  readonly database: Pick<Database, "withTransaction" | "withTransactionResult">;
  readonly accounts: { lockActiveUserShared(tx: Tx, accountId: AccountId): Promise<unknown | null> };
  readonly movieLocks: Pick<MovieLocks, "lockActiveMovieShared">;
  readonly reviews: Pick<ReportRepository, "findForReport" | "lockForReport">;
  readonly reports: Pick<ReportRepository, "insert">;
  readonly rateLimiter: RateLimiter;
  readonly rateLimitKeys: Pick<RateLimitKeys, "forAccount">;
}

export function createReportService(deps: ReportServiceDependencies): ReportService {
  return {
    async submit(reporterId, reviewId, input) {
      const admission = await deps.rateLimiter.consume(
        deps.rateLimitKeys.forAccount("report_create", reporterId),
        RATE_LIMIT_POLICIES.report_create,
        1,
      );
      if (!admission.allowed) return { ok: false, error: { kind: "rate_limited", retryAfterSeconds: admission.retryAfterSeconds } };

      const target = await deps.database.withTransaction((tx) => deps.reviews.findForReport(tx, reviewId));
      if (target === null) return { ok: false, error: { kind: "not_found" } };
      if (target.authorId === reporterId) return { ok: false, error: { kind: "forbidden" } };

      try {
        return await deps.database.withTransactionResult<ReportReceipt, ReportSubmissionRejection>(async (tx) => {
          if ((await deps.accounts.lockActiveUserShared(tx, reporterId)) === null) return { ok: false, error: { kind: "forbidden" } };
          const movie = await deps.movieLocks.lockActiveMovieShared(tx, target.movieId);
          if (!movie.ok) return { ok: false, error: { kind: "not_found" } };
          const locked = await deps.reviews.lockForReport(tx, target.movieId, reviewId);
          if (locked === null || locked.movieArchived) return { ok: false, error: { kind: "not_found" } };
          if (locked.authorId === reporterId) return { ok: false, error: { kind: "forbidden" } };
          if (locked.deletedAt !== null || locked.hiddenAt !== null || locked.moderationState !== "cleared") {
            return { ok: false, error: { kind: "conflict" } };
          }
          const report = await deps.reports.insert(tx, {
            reporterId,
            targetUserId: locked.authorId,
            reviewId,
            category: input.category,
            explanation: input.explanation,
            evidenceSnapshot: {
              reviewId: locked.reviewId,
              reviewVersion: locked.reviewVersion,
              authorId: locked.authorId,
              movieId: locked.movieId,
              movieTitle: locked.movieTitle,
              body: locked.body,
              rating: locked.rating,
            },
          });
          return { ok: true, value: { id: report.id, reviewId: report.reviewId, category: report.category, status: report.status, createdAt: report.createdAt } };
        });
      } catch (error) {
        if (error instanceof TransactionConflict || isUniqueViolation(error)) return { ok: false, error: { kind: "conflict" } };
        throw error;
      }
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
