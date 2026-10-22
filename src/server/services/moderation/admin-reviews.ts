import "server-only";

import type { Database } from "../../db";
import type { AdminReview, AdminReviewQueryRepository } from "../../repositories/moderation/admin-review-query-repository";
import type { AdminReviewWorkRepository } from "../../repositories/moderation/admin-review-work-repository";
import type { DomainError, RequestId, Result, ReviewId, ReviewUpdateLock, RowVersion, Tx } from "../../shared";
import { PROFANITY_POLICY_VERSION } from "../ai/moderation/policy/version";
import { REVIEW_SCREENING_PROMPT_VERSION } from "../ai/moderation/prompt-version";
import type { AuditLog } from "../audit";
import type { Principal } from "../identity";
import type { AdminReviewTransitions, ReviewLocks, ReviewTransitionResult } from "../reviews/review-transitions";
import { parseAdminReviewReason, type AdminReviewFilters } from "./admin-review-input";

export interface AdminReviewPage { readonly items: readonly AdminReview[]; readonly total: number }
type ReadResult<T> = Promise<Result<T, DomainError>>;
type Mutation = (principal: Principal, reviewId: ReviewId, expected: RowVersion, input: unknown, requestId: RequestId) => ReadResult<ReviewTransitionResult>;
export interface AdminReviewService {
  list(principal: Principal, filters: AdminReviewFilters, page: number, pageSize: number): ReadResult<AdminReviewPage>;
  get(principal: Principal, reviewId: ReviewId): ReadResult<AdminReview>;
  approve: Mutation;
  hide: Mutation;
  restore: Mutation;
}
export interface AdminReviewDependencies {
  readonly database: Database;
  readonly queries: AdminReviewQueryRepository;
  readonly reviewLocks: Pick<ReviewLocks, "lockReviewForTransition">;
  readonly transitions: Pick<AdminReviewTransitions, "approveHeldReview" | "hideReview" | "restoreHiddenReview">;
  readonly work: AdminReviewWorkRepository;
  readonly auditLog: AuditLog;
}

/** FR-09, SEC-09: manual transitions only. No provider, dispatcher, Report or strike dependency. */
export function createAdminReviewService(deps: AdminReviewDependencies): AdminReviewService {
  const { database, queries, reviewLocks, transitions, work, auditLog } = deps;
  type Transition = AdminReviewTransitions["approveHeldReview"];
  type WorkChange = (tx: Tx, locked: ReviewUpdateLock, result: ReviewTransitionResult) => Promise<void>;

  // Shared transaction boundary; behavior is supplied by named operations, never a branch-selection flag.
  function mutation(action: "review.approve" | "review.hide" | "review.restore", transition: Transition, changeWork: WorkChange): Mutation {
    return async (principal, reviewId, expected, input, requestId) => {
      if (principal.role !== "ADMIN") return { ok: false, error: { kind: "forbidden" } };
      const parsed = parseAdminReviewReason(input);
      if (!parsed.ok) return { ok: false, error: { kind: "invalid_fields", fieldErrors: parsed.error } };
      return database.withTransactionResult<ReviewTransitionResult, DomainError>(async (tx) => {
        const locked = await reviewLocks.lockReviewForTransition(tx, reviewId);
        if (!locked.ok) return locked;
        const changed = await transition(tx, locked.value, expected);
        if (!changed.ok) return changed;
        const result = changed.value;
        const applied = result.version !== locked.value.version;
        if (applied) await changeWork(tx, locked.value, result);
        await auditLog.record(tx, {
          actorId: principal.accountId, action, targetType: "review", targetId: reviewId,
          result: applied ? "applied" : "no_op", requestId,
          metadata: {
            reason: parsed.value.reason, previousVersion: locked.value.version, newVersion: result.version,
            previousModerationState: locked.value.moderationState, moderationState: result.moderationState,
            previouslyHidden: locked.value.hidden, hidden: result.hidden, deleted: result.deleted,
            contentRevision: locked.value.contentRevision,
          },
        });
        return { ok: true, value: result };
      });
    };
  }
  return {
    async list(principal, filters, page, pageSize) {
      if (principal.role !== "ADMIN") return { ok: false, error: { kind: "forbidden" } };
      return database.withTransaction(async (tx) => {
        const total = await queries.count(tx, filters);
        const offset = (page - 1) * pageSize;
        const items = offset >= total ? [] : await queries.list(tx, filters, pageSize, offset);
        return { ok: true, value: { items, total } };
      });
    },
    async get(principal, reviewId) {
      if (principal.role !== "ADMIN") return { ok: false, error: { kind: "forbidden" } };
      const review = await database.withTransaction((tx) => queries.get(tx, reviewId));
      return review === null ? { ok: false, error: { kind: "not_found" } } : { ok: true, value: review };
    },
    approve: mutation("review.approve", transitions.approveHeldReview, (tx, locked) => work.supersedeOutstanding(tx, locked.reviewId)),
    hide: mutation("review.hide", transitions.hideReview, (tx, locked) => work.cancelOutstanding(tx, locked.reviewId)),
    restore: mutation("review.restore", transitions.restoreHiddenReview, async (tx, locked, result) => {
      if (result.moderationState !== "pending" || result.deleted) return;
      await work.reactivate(tx, {
        reviewId: locked.reviewId, contentRevision: locked.contentRevision,
        promptVersion: REVIEW_SCREENING_PROMPT_VERSION, policyVersion: PROFANITY_POLICY_VERSION,
      });
    }),
  };
}
