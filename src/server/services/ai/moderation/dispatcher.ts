import "server-only";

import { randomUUID } from "node:crypto";

import type { Database } from "../../../db";
import type {
  ModerationReviewReadRepository,
  ModerationWorkRepository,
  ModerationWorkRow,
  ReviewModerationRepository,
} from "../../../repositories/ai";
import type {
  AccountId,
  AiJobId,
  ContentRevision,
  RequestId,
  Result,
  ReviewId,
  ReviewUpdateLock,
  RowVersion,
  Tx,
} from "../../../shared";
import type { AuditLog } from "../../audit";
import type { ReviewLocksAndReads, ReviewTransitions } from "../../reviews";
import type { AiExecutionController, AiExecutionOutcome, BoundedInput } from "../runtime";
import { buildModerationInput, type ScreeningSubject } from "./input";
import { parseModerationOutput, type ModerationAssessment, type ModerationOutput } from "./output-schema";
import { PROFANITY_POLICY_VERSION } from "./policy/version";
import { MODERATION_MAX_OUTPUT_TOKENS } from "./prompt";
import { REVIEW_SCREENING_PROMPT_VERSION } from "./prompt-version";
import type { ModerationDispatcher, ModerationRecovery, ScreeningAttempt } from "./types";

/** The review and cron routes' `maxDuration`: an expired claim never belongs to a live execution (D-101). */
export const MODERATION_CLAIM_SECONDS = 120;

const FAILURE_BACKOFF_BASE_SECONDS = 15 * 60;
const FAILURE_BACKOFF_FACTOR = 4;
const MAX_DELAY_SECONDS = 24 * 60 * 60;

/** D-101: 15 minutes × 4^(executions − 1), at most 1 day. */
export function failureBackoffSeconds(executions: number): number {
  return Math.min(FAILURE_BACKOFF_BASE_SECONDS * FAILURE_BACKOFF_FACTOR ** (executions - 1), MAX_DELAY_SECONDS);
}

/** D-101: a K10 retry hint, 0 when absent, at most 1 day. */
function deferralSeconds(retryAfterSeconds: number | null): number {
  return Math.min(retryAfterSeconds ?? 0, MAX_DELAY_SECONDS);
}

export interface ModerationSettings {
  /** The provider's model, recorded on ModerationWork (D-50) and ReviewModeration. */
  readonly modelId: string;
  /** `AI_INPUT_TOKEN_LIMIT`, the bound K10 enforces. */
  readonly inputTokenLimit: number;
  /** `AI_MODERATION_MAX_EXECUTIONS`. */
  readonly maxExecutions: number;
}

/** The claimed row and the captured Review version: all the publish and settlement Txs need. */
interface ClaimedWork {
  readonly workId: string;
  readonly reviewId: ReviewId;
  readonly contentRevision: ContentRevision;
  readonly version: RowVersion;
}

/** What the claim transaction hands to the K10 call. */
interface Claimed {
  readonly kind: "claimed";
  readonly work: ClaimedWork;
  /** The screened body, which output quotes must copy (D-100). */
  readonly body: string;
  readonly input: BoundedInput;
  readonly requesterId: AccountId | null;
}

/** Reads the AIJob requester in the claim Tx (D-64): the author for a review write, none for the sweep. */
type RequesterRead = (tx: Tx, reviewId: ReviewId) => Promise<AccountId | null>;

type ClaimResult = Claimed | { readonly kind: "settled"; readonly result: ScreeningAttempt };

const settled = (result: ScreeningAttempt): ClaimResult => ({ kind: "settled", result });

const STALE: Result<never, { readonly kind: "stale" }> = Object.freeze({
  ok: false,
  error: Object.freeze({ kind: "stale" }),
});
const PUBLISHED: Result<void, never> = Object.freeze({ ok: true, value: undefined });

const OUTSTANDING: readonly ModerationWorkRow["status"][] = Object.freeze(["pending", "running", "needs_manual_review"]);

function isCurrentVersion(row: ModerationWorkRow): boolean {
  return row.promptVersion === REVIEW_SCREENING_PROMPT_VERSION && row.policyVersion === PROFANITY_POLICY_VERSION;
}

function outstandingIds(rows: readonly ModerationWorkRow[]): string[] {
  return rows.filter((row) => OUTSTANDING.includes(row.status)).map((row) => row.id);
}

/** Other-version work that no execution holds: `pending`, or `running` with an expired claim (D-101, D-103). */
function isUnheldOtherVersion(row: ModerationWorkRow): boolean {
  return !isCurrentVersion(row) && (row.status === "pending" || (row.status === "running" && row.claimExpired));
}

/** D-103 L3: leftover other-version work beside a settled current-version row, so it cannot hold the sweep slot. */
function obsoleteOtherVersionIds(rows: readonly ModerationWorkRow[]): string[] {
  return rows.filter(isUnheldOtherVersion).map((row) => row.id);
}

/** AI-02's fixed publication rule: clean → cleared; suspected or uncertain → flagged. */
function attemptFor(assessment: ModerationAssessment): ScreeningAttempt {
  return assessment === "no_profanity_detected" ? "cleared" : "flagged";
}

/**
 * The real K9 dispatcher (D-101), which also serves the recovery sweep. Every ModerationWork write runs in a
 * short Tx that takes K8 `lockReviewForTransition` first and writes no K10 bookkeeping (D-58). The provider call
 * runs inside K10 with no Tx open. It never calls report, strike or account-status services (AI-02).
 */
export function createModerationDispatcher(deps: {
  readonly database: Database;
  readonly reviewLocks: Pick<ReviewLocksAndReads, "lockReviewForTransition" | "readReviewForScreening">;
  readonly transitions: Pick<ReviewTransitions, "applyAutomaticClearance" | "applyAutomaticFlag">;
  readonly work: ModerationWorkRepository;
  readonly reviewReads: Pick<ModerationReviewReadRepository, "readAuthorId">;
  readonly results: ReviewModerationRepository;
  readonly auditLog: AuditLog;
  readonly controller: AiExecutionController;
  readonly settings: ModerationSettings;
}): ModerationDispatcher & ModerationRecovery {
  const { database, work, settings } = deps;

  /**
   * Claim steps 1–4 (D-101): whether the Review still needs this revision screened. Returns `null` when it does,
   * otherwise the result after cancelling or superseding what is no longer needed. `rows` are the revision's
   * rows, already locked.
   */
  async function reviewGate(
    tx: Tx,
    review: ReviewUpdateLock,
    contentRevision: ContentRevision,
    rows: readonly ModerationWorkRow[],
  ): Promise<ScreeningAttempt | null> {
    if (review.contentRevision !== contentRevision) {
      await work.supersede(tx, outstandingIds(rows));
      return "not_current";
    }
    if (review.hidden || review.deleted) {
      await work.cancelOutstanding(tx, review.reviewId);
      return "not_current";
    }
    if (review.moderationState !== "pending") {
      await work.supersede(tx, outstandingIds(rows));
      return "not_current";
    }
    return review.movie.archived ? "deferred" : null;
  }

  /** Claim step 5 (D-49, D-101): the current-version row, migrating older-version work when needed. */
  async function currentVersionRow(
    tx: Tx,
    reviewId: ReviewId,
    contentRevision: ContentRevision,
    rows: readonly ModerationWorkRow[],
  ): Promise<ModerationWorkRow | ScreeningAttempt> {
    const current = rows.find(isCurrentVersion);
    if (current !== undefined) {
      return current;
    }
    if (rows.some((row) => row.status === "running" && !row.claimExpired)) {
      return "deferred";
    }
    const migratable = obsoleteOtherVersionIds(rows);
    if (migratable.length === 0) {
      return rows.some((row) => row.status === "needs_manual_review") ? "manual_review" : "not_current";
    }
    await work.supersede(tx, migratable);
    await work.insertPendingUnlessRecorded(tx, {
      reviewId,
      contentRevision,
      promptVersion: REVIEW_SCREENING_PROMPT_VERSION,
      policyVersion: PROFANITY_POLICY_VERSION,
    });
    const inserted = (await work.lockRevision(tx, reviewId, contentRevision)).find(isCurrentVersion);
    if (inserted === undefined) {
      throw new Error("current-version moderation work was not inserted");
    }
    return inserted;
  }

  /** The claim Tx (D-101 steps 1–10). */
  async function claim(
    tx: Tx,
    reviewId: ReviewId,
    contentRevision: ContentRevision,
    readRequester: RequesterRead,
  ): Promise<ClaimResult> {
    const locked = await deps.reviewLocks.lockReviewForTransition(tx, reviewId);
    if (!locked.ok) {
      return settled("not_current");
    }
    const review = locked.value;
    const rows = await work.lockRevision(tx, reviewId, contentRevision);
    const gate = await reviewGate(tx, review, contentRevision, rows);
    if (gate !== null) {
      return settled(gate);
    }
    const current = await currentVersionRow(tx, reviewId, contentRevision, rows);
    if (typeof current === "string") {
      return settled(current);
    }

    let executions: number;
    switch (current.status) {
      case "completed":
      case "superseded":
      case "cancelled":
        await work.supersede(tx, obsoleteOtherVersionIds(rows));
        return settled("not_current");
      case "needs_manual_review":
        await work.supersede(tx, obsoleteOtherVersionIds(rows));
        return settled("manual_review");
      case "running":
        if (!current.claimExpired) {
          return settled("deferred");
        }
        // Step 7: a crashed execution's claim counts as one failed execution (D-77).
        executions = await work.recordAbandonedExecution(tx, current.id);
        break;
      case "pending":
        executions = current.executionCount;
        break;
    }
    if (executions >= settings.maxExecutions) {
      await work.markNeedsManualReview(tx, current.id);
      return settled("manual_review");
    }

    const source = await deps.reviewLocks.readReviewForScreening(tx, reviewId);
    if (!source.ok) {
      return settled("not_current");
    }
    const subject: ScreeningSubject = {
      reviewId,
      contentRevision: review.contentRevision,
      version: review.version,
      body: source.value.body,
    };
    const prepared = buildModerationInput(subject, settings.inputTokenLimit);
    if (prepared.kind === "input_too_large") {
      await work.markNeedsManualReview(tx, current.id);
      return settled("manual_review");
    }
    await work.claim(tx, current.id, settings.modelId, MODERATION_CLAIM_SECONDS);
    return {
      kind: "claimed",
      work: { workId: current.id, reviewId, contentRevision: subject.contentRevision, version: subject.version },
      body: subject.body,
      input: prepared.input,
      requesterId: await readRequester(tx, reviewId),
    };
  }

  /** The K10 publish callback body (contracts §3.3, D-101). Any rejection rolls the publish Tx back. */
  async function publish(
    tx: Tx,
    claimed: ClaimedWork,
    output: ModerationOutput,
    jobId: AiJobId,
    requestId: RequestId,
  ): Promise<Result<void, { readonly kind: "stale" }>> {
    const { reviewId, contentRevision, version } = claimed;
    const locked = await deps.reviewLocks.lockReviewForTransition(tx, reviewId);
    if (!locked.ok) {
      return STALE;
    }
    const rows = await work.lockRevision(tx, reviewId, contentRevision);
    if (!rows.some((row) => row.id === claimed.workId && row.status === "running")) {
      return STALE;
    }
    const captured = { contentRevision, version };
    const transition =
      output.assessment === "no_profanity_detected"
        ? await deps.transitions.applyAutomaticClearance(tx, locked.value, captured)
        : await deps.transitions.applyAutomaticFlag(tx, locked.value, captured);
    if (!transition.ok) {
      return STALE;
    }
    await deps.results.insert(tx, {
      jobId,
      reviewId,
      contentRevision,
      capturedReviewVersion: version,
      modelId: settings.modelId,
      promptVersion: REVIEW_SCREENING_PROMPT_VERSION,
      policyVersion: PROFANITY_POLICY_VERSION,
      outputJson: JSON.stringify(output),
    });
    await work.complete(tx, claimed.workId);
    await deps.auditLog.record(tx, {
      actorId: null,
      action: attemptFor(output.assessment) === "cleared" ? "review.auto_clear" : "review.auto_flag",
      targetType: "review",
      targetId: reviewId,
      result: "applied",
      metadata: { assessment: output.assessment, contentRevision, jobId },
      requestId,
    });
    return PUBLISHED;
  }

  /** The settlement Tx after any outcome but `published` (D-101 table). Writes only while the claim runs. */
  function settle(claimed: ClaimedWork, outcome: Exclude<AiExecutionOutcome, { readonly kind: "published" }>) {
    const { reviewId, contentRevision } = claimed;
    return database.withTransaction(async (tx): Promise<ScreeningAttempt> => {
      const locked = await deps.reviewLocks.lockReviewForTransition(tx, reviewId);
      if (!locked.ok) {
        return "not_current";
      }
      const rows = await work.lockRevision(tx, reviewId, contentRevision);
      const row = rows.find(({ id }) => id === claimed.workId);
      if (row?.status !== "running") {
        // A hide, deletion, edit or Admin decision already handled this work.
        return "not_current";
      }
      switch (outcome.kind) {
        case "deferred":
          await work.releaseClaim(tx, row.id, deferralSeconds(outcome.retryAfterSeconds));
          return "deferred";
        case "disabled":
        case "duplicate":
          await work.releaseClaim(tx, row.id, 0);
          return "deferred";
        case "input_too_large":
          await work.markNeedsManualReview(tx, row.id);
          return "manual_review";
        case "failed": {
          const executions = row.executionCount + 1;
          if (outcome.cause !== "transient" || executions >= settings.maxExecutions) {
            await work.recordFailedExecutionForManualReview(tx, row.id);
            return "manual_review";
          }
          await work.recordFailedExecution(tx, row.id, failureBackoffSeconds(executions));
          return "deferred";
        }
        case "stale": {
          const gate = await reviewGate(tx, locked.value, contentRevision, rows);
          if (gate === "deferred") {
            // Archived meanwhile: the work waits for the restore (AI-02, D-103).
            await work.recordStaleAttempt(tx, row.id);
            return "deferred";
          }
          if (gate !== null) {
            return gate;
          }
          await work.recordStaleAttempt(tx, row.id);
          return "not_current";
        }
      }
    });
  }

  async function attempt(
    reviewId: ReviewId,
    contentRevision: ContentRevision,
    requestId: RequestId,
    readRequester: RequesterRead,
  ): Promise<ScreeningAttempt> {
    try {
      const claimed = await database.withTransaction((tx) => claim(tx, reviewId, contentRevision, readRequester));
      if (claimed.kind === "settled") {
        return claimed.result;
      }
      const { work: claimedWork } = claimed;
      // Set by a publish callback that succeeded; read only when K10 reports `published`, because the publish Tx
      // can still roll back after the callback returns (P-08).
      const published: { assessment: ModerationAssessment | null } = { assessment: null };
      const outcome = await deps.controller.run<ModerationOutput>({
        job: {
          type: "review_moderation",
          reviewId,
          captured: { contentRevision: claimedWork.contentRevision, version: claimedWork.version },
          requesterId: claimed.requesterId,
          promptVersion: REVIEW_SCREENING_PROMPT_VERSION,
          policyVersion: PROFANITY_POLICY_VERSION,
        },
        input: claimed.input,
        maxOutputTokens: MODERATION_MAX_OUTPUT_TOKENS,
        validate: (content) => parseModerationOutput(content, claimed.body),
        publish: async (tx, output, job) => {
          const result = await publish(tx, claimedWork, output, job.jobId, requestId);
          published.assessment = result.ok ? output.assessment : null;
          return result;
        },
      });
      if (outcome.kind === "published") {
        return published.assessment === null ? "not_current" : attemptFor(published.assessment);
      }
      return await settle(claimedWork, outcome);
    } catch {
      // A fault leaves any claim to expire; the sweep recovers it (D-77, D-101).
      return "deferred";
    }
  }

  const noRequester: RequesterRead = () => Promise.resolve(null);

  return {
    attemptAfterCommit(reviewId, contentRevision) {
      // D-103: K9 carries no request ID, so the attempt's audit entries get their own.
      return attempt(reviewId, contentRevision, randomUUID() as RequestId, deps.reviewReads.readAuthorId);
    },
    attemptFromSweep(reviewId, contentRevision, requestId) {
      return attempt(reviewId, contentRevision, requestId, noRequester);
    },
  };
}
