import "server-only";

import type { LlmMessage } from "../../../adapters/soc-llm";
import type {
  AccountId,
  AiJobId,
  ContentRevision,
  MovieId,
  Result,
  ReviewId,
  ReviewsRevision,
  RowVersion,
  Tx,
} from "../../../shared";

// K10 execution controller contract (workflow/contracts.md §13, §22 AM-15; D-52).

export type AiJobDescriptor =
  | {
      readonly type: "summary";
      readonly movieId: MovieId;
      readonly reviewsRevision: ReviewsRevision;
      readonly promptVersion: string;
    }
  | {
      readonly type: "review_moderation";
      readonly reviewId: ReviewId;
      // K8's CapturedReviewVersion (contracts §11), written structurally until A#6 adds that module.
      readonly captured: { readonly contentRevision: ContentRevision; readonly version: RowVersion };
      /** The author for review_write; `null` for the recovery sweep. */
      readonly requesterId: AccountId | null;
      readonly promptVersion: string;
      readonly policyVersion: string;
    };

export interface BoundedInput {
  readonly messages: readonly LlmMessage[];
  readonly estimatedInputTokens: number;
  /** Persisted as bounded_input_snapshot. */
  readonly snapshot: Readonly<Record<string, unknown>>;
}

export interface AiJobRef {
  readonly jobId: AiJobId;
}

export interface AiExecutionRequest<T> {
  readonly job: AiJobDescriptor;
  readonly input: BoundedInput;
  /** 1,200 for summaries, 1,000 for review moderation. */
  readonly maxOutputTokens: number;
  readonly validate: (content: string) => Result<T, { readonly kind: "invalid_output" }>;
  readonly publish: (tx: Tx, output: T, job: AiJobRef) => Promise<Result<void, { readonly kind: "stale" }>>;
}

export type AiExecutionOutcome =
  | { readonly kind: "published"; readonly jobId: AiJobId }
  /** AI_ENABLED=false or configuration missing; no job row. */
  | { readonly kind: "disabled" }
  /** Slot, budget or quota; no attempt consumed. */
  | { readonly kind: "deferred"; readonly retryAfterSeconds: number | null }
  /** An active job holds the dedup key. */
  | { readonly kind: "duplicate"; readonly jobId: AiJobId }
  /** Over AI_INPUT_TOKEN_LIMIT; no provider call. */
  | { readonly kind: "input_too_large" }
  | {
      readonly kind: "failed";
      readonly jobId: AiJobId;
      readonly cause: "transient" | "invalid_output" | "provider_rejected";
    }
  /** Publish rejected or lease lost. */
  | { readonly kind: "stale"; readonly jobId: AiJobId };

export interface AiExecutionController {
  /** No Tx open on entry. Single call, so no temporal coupling (AGENTS.md). */
  run<T>(request: AiExecutionRequest<T>): Promise<AiExecutionOutcome>;
}

/** O-30; `ai_execution` is K10-internal. */
export type SweepLeaseName = "summary_sweep" | "review_moderation_sweep";

export interface SchedulerLeases {
  /** Own Tx to acquire; `work` runs with no Tx held; own Tx to release by lease_token. */
  withSweepLease<T>(
    name: SweepLeaseName,
    work: () => Promise<T>,
  ): Promise<{ readonly acquired: false } | { readonly acquired: true; readonly value: T }>;
}
