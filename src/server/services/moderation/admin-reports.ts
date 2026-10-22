import "server-only";

import type { Database } from "../../db";
import type { DomainError, ReportId, RequestId, Result, RowVersion } from "../../shared";
import type { Principal } from "../identity";
import type { AdminReportFilters } from "./admin-report-input";
import type { AdminReportDecisionInput } from "./admin-report-decision-input";
import type { AdminReportDetail, AdminReportListItem, AdminReportQueryRepository } from "../../repositories/moderation/admin-report-query-repository";
import type { AdminReportMutationRepository } from "../../repositories/moderation/admin-report-mutation-repository";
import type { AccountStatusService } from "../identity/account-status";
import type { AuditLog } from "../audit";
import type { MovieLocks } from "../catalogue";
import type { ReviewLocks, ReviewTransitions } from "../reviews";
import type { AdminReviewWorkRepository } from "../../repositories/moderation/admin-review-work-repository";

export interface AdminReportPage { readonly items: readonly AdminReportListItem[]; readonly total: number }
export interface AdminReportDecisionResult { readonly report: AdminReportDetail; readonly decision: { readonly id: string; readonly disposition: "accepted" | "dismissed"; readonly actions: readonly string[]; readonly reason: string }; readonly strikeAdded: boolean; readonly accountStatus: "active" | "suspended"; readonly version: RowVersion }
export interface AdminReportService {
  list(principal: Principal, filters: AdminReportFilters, page: number, pageSize: number): Promise<Result<AdminReportPage, DomainError>>;
  get(principal: Principal, reportId: ReportId): Promise<Result<AdminReportDetail, DomainError>>;
  decide(principal: Principal, reportId: ReportId, expectedVersion: RowVersion, input: AdminReportDecisionInput, requestId: RequestId): Promise<Result<AdminReportDecisionResult, DomainError>>;
}

export function createAdminReportService(deps: {
  readonly database: Pick<Database, "withTransaction" | "withTransactionResult">;
  readonly reports: AdminReportQueryRepository;
  readonly mutations?: AdminReportMutationRepository;
  readonly accountStatus?: Pick<AccountStatusService, "lockUserAccount" | "suspend">;
  readonly movieLocks?: Pick<MovieLocks, "lockMovieForUpdate">;
  readonly reviewLocks?: Pick<ReviewLocks, "lockReviewForTransition">;
  readonly transitions?: Pick<ReviewTransitions, "hideReviewForAcceptedReport">;
  readonly work?: Pick<AdminReviewWorkRepository, "cancelOutstanding">;
  readonly auditLog?: AuditLog;
  readonly strikeThreshold?: number;
}): AdminReportService {
  return {
    async list(principal, filters, page, pageSize) {
      if (principal.role !== "ADMIN") return { ok: false, error: { kind: "forbidden" } };
      return deps.database.withTransaction(async (tx) => {
        const total = await deps.reports.count(tx, filters);
        const offset = (page - 1) * pageSize;
        const items = offset >= total ? [] : await deps.reports.list(tx, filters, pageSize, offset);
        return { ok: true, value: { items, total } };
      });
    },
    async get(principal, reportId) {
      if (principal.role !== "ADMIN") return { ok: false, error: { kind: "forbidden" } };
      return deps.database.withTransaction(async (tx) => {
        const report = await deps.reports.get(tx, reportId);
        return report === null ? { ok: false, error: { kind: "not_found" } } : { ok: true, value: report };
      });
    },
    async decide(principal, reportId, expectedVersion, input, requestId) {
      if (principal.role !== "ADMIN") return { ok: false, error: { kind: "forbidden" } };
      const { mutations, accountStatus, movieLocks, reviewLocks, transitions, work, auditLog, strikeThreshold } = deps;
      if (mutations === undefined || auditLog === undefined) return { ok: false, error: { kind: "unavailable" } };
      return deps.database.withTransactionResult<AdminReportDecisionResult, DomainError>(async (tx) => {
        const target = await mutations.findDecisionTarget(tx, reportId);
        if (target === null) return { ok: false, error: { kind: "not_found" } };
        if (input.disposition === "dismissed") {
          const report = await mutations.lockDecision(tx, reportId);
          if (report === null) return { ok: false, error: { kind: "not_found" } };
          if (report.version !== expectedVersion) return { ok: false, error: { kind: "stale_version" } };
          if (report.status !== "open") return { ok: false, error: { kind: "conflict" } };
          const decisionId = await mutations.insertDecision(tx, { reportId, adminId: principal.accountId, disposition: input.disposition, actions: input.actions, reason: input.reason });
          const version = await mutations.close(tx, reportId, expectedVersion, input.disposition);
          const updated = await deps.reports.get(tx, reportId);
          if (updated === null) return { ok: false, error: { kind: "not_found" } };
          await auditLog.record(tx, { actorId: principal.accountId, action: "report.dismiss", targetType: "report", targetId: reportId, result: "applied", requestId, metadata: { reason: input.reason, previousVersion: expectedVersion, newVersion: version, strikeAdded: false, accountStatus: report.targetStatus ?? "active" } });
          return { ok: true, value: { report: updated, decision: { id: decisionId, disposition: input.disposition, actions: input.actions, reason: input.reason }, strikeAdded: false, accountStatus: report.targetStatus ?? "active", version } };
        }
        if (accountStatus === undefined || movieLocks === undefined || reviewLocks === undefined || transitions === undefined || work === undefined || strikeThreshold === undefined) return { ok: false, error: { kind: "unavailable" } };
        const account = await accountStatus.lockUserAccount(tx, target.targetUserId);
        if (!account.ok) return { ok: false, error: { kind: "not_found" } };
        const movie = await movieLocks.lockMovieForUpdate(tx, target.movieId);
        if (!movie.ok) return { ok: false, error: { kind: "not_found" } };
        const review = await reviewLocks.lockReviewForTransition(tx, target.reviewId);
        if (!review.ok) return { ok: false, error: { kind: "not_found" } };
        const report = await mutations.lockDecision(tx, reportId);
        if (report === null) return { ok: false, error: { kind: "not_found" } };
        if (report.version !== expectedVersion) return { ok: false, error: { kind: "stale_version" } };
        if (report.status !== "open") return { ok: false, error: { kind: "conflict" } };
        if (report.targetUserId !== target.targetUserId || report.reviewId !== target.reviewId || report.movieId !== target.movieId) return { ok: false, error: { kind: "conflict" } };
        const decisionId = await mutations.insertDecision(tx, { reportId, adminId: principal.accountId, disposition: input.disposition, actions: input.actions, reason: input.reason });
        let strikeAdded = false;
        let resultingAccountStatus = account.value.status;
        if (input.disposition === "accepted") {
          const currentStrikes = await mutations.countCurrentCycleStrikes(tx, target.targetUserId, account.value.strikeCycle);
          strikeAdded = await mutations.insertStrike(tx, { targetUserId: target.targetUserId, reviewId: target.reviewId, acceptedReportId: reportId, strikeCycle: account.value.strikeCycle });
          if (input.actions.includes("hide_review")) {
            await transitions.hideReviewForAcceptedReport(tx, review.value);
            await work.cancelOutstanding(tx, target.reviewId);
          }
          if (account.value.status === "active" && currentStrikes + (strikeAdded ? 1 : 0) >= strikeThreshold) resultingAccountStatus = (await accountStatus.suspend(tx, account.value)).after;
        }
        const version = await mutations.close(tx, reportId, expectedVersion, input.disposition);
        await auditLog.record(tx, { actorId: principal.accountId, action: input.disposition === "accepted" ? "report.accept" : "report.dismiss", targetType: "report", targetId: reportId, result: "applied", requestId, metadata: { reason: input.reason, previousVersion: expectedVersion, newVersion: version, strikeAdded, accountStatus: resultingAccountStatus } });
        const updated = await deps.reports.get(tx, reportId);
        if (updated === null) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: { report: updated, decision: { id: decisionId, disposition: input.disposition, actions: input.actions, reason: input.reason }, strikeAdded, accountStatus: resultingAccountStatus, version } };
      });
    },
  };
}
