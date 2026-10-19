import "server-only";

import type { LlmCompletion, LlmFailure, LlmProvider } from "../../../adapters/soc-llm";
import type { Database, Sql } from "../../../db";
import {
  createAiBudgetRepository,
  createAiJobRepository,
  createSchedulerLeaseRepository,
  type FinalJobStatus,
} from "../../../repositories/ai";
import type { AiJobId, Result, Tx } from "../../../shared";
import type { RateLimiter, RateLimitKey, RateLimitPolicy } from "../../rate-limit";
import { newAiJob } from "./job-record";
import { costMicrodollars, estimateInputTokens, type TokenPrices } from "./pricing";
import { attemptCharge, planSettlement, type AttemptCharge } from "./settlement";
import type { AiExecutionController, AiExecutionOutcome, AiExecutionRequest } from "./types";

/** The AI configuration the controller enforces (AI-03, D-65); the composition root maps it from AiSettings. */
export interface AiExecutionLimits {
  readonly maxAttempts: number;
  readonly attemptTimeoutMs: number;
  readonly executionDeadlineMs: number;
  readonly inputTokenLimit: number;
  /** SOC_LLM_REQUESTS_PER_MINUTE, the `soc_requests` policy limit (D-44, D-62). */
  readonly requestsPerMinute: number;
  readonly dailyBudgetMicrodollars: number;
  readonly prices: TokenPrices;
}

export interface AiExecutionControllerDeps {
  readonly database: Database;
  readonly sql: Sql;
  readonly rateLimiter: RateLimiter;
  /** The environment `soc_requests` key (D-44). */
  readonly socRequestKey: RateLimitKey;
  readonly provider: LlmProvider;
  readonly limits: AiExecutionLimits;
  /** Uniform in [0, 1), for retry jitter (D-69). */
  readonly random: () => number;
  /** Monotonic milliseconds; the deadline is measured on it (D-65, D-69). */
  readonly clock: () => number;
  /** Resolves after `ms`, or at once when `cancel` aborts; never rejects (D-69). */
  readonly sleep: (ms: number, cancel?: AbortSignal) => Promise<void>;
}

const AI_EXECUTION_LEASE = "ai_execution";
/** The larger AI-03 output cap; any other value is a caller bug (D-68). */
const MAX_OUTPUT_TOKENS = 1_200;
/** The lease outlives the deadline by this much (D-65). */
const LEASE_MARGIN_MS = 15_000;
/** Attempts end this long before the deadline, leaving time for storage (D-65). */
const STORAGE_MARGIN_MS = 5_000;
/** An attempt, the first included, starts only with this much time left before the attempt end point (D-65, D-76). */
const MIN_ATTEMPT_WINDOW_MS = 5_000;
/** Backoff without Retry-After is uniform in [1,000, 3,000) ms (D-69). */
const JITTER_MIN_MS = 1_000;
const JITTER_SPAN_MS = 2_000;
const SOC_REQUESTS_WINDOW_SECONDS = 60;

const INPUT_TOO_LARGE: AiExecutionOutcome = Object.freeze({ kind: "input_too_large" });
const UNAVAILABLE: Result<LlmCompletion, LlmFailure> = Object.freeze({
  ok: false,
  error: Object.freeze({ kind: "unavailable" }),
});

function deferred(retryAfterSeconds: number | null): AiExecutionOutcome {
  return { kind: "deferred", retryAfterSeconds };
}

/** How `run` stops before or at step 1, or the running job it created there. */
type Start =
  | { readonly kind: "started"; readonly jobId: AiJobId; readonly leaseToken: string }
  | { readonly kind: "stopped"; readonly outcome: AiExecutionOutcome };

function stopped(outcome: AiExecutionOutcome): Start {
  return { kind: "stopped", outcome };
}

interface Attempts {
  /** The last result, or `null` when no request was sent. */
  readonly last: Result<LlmCompletion, LlmFailure> | null;
  /** One entry per request sent. */
  readonly charges: readonly AttemptCharge[];
}

/** The decided outcome and the final job status the settlement writes; `null` when publish already wrote it. */
interface Decision {
  readonly outcome: AiExecutionOutcome;
  readonly job: Omit<FinalJobStatus, "attemptCount"> | null;
}

function failed(
  jobId: AiJobId,
  cause: "transient" | "invalid_output" | "provider_rejected",
  errorCode: string,
): Decision {
  return { outcome: { kind: "failed", jobId, cause }, job: { status: "failed", errorCode } };
}

/** D-61, D-74: the outcome of the last provider attempt. */
function fromFailure(jobId: AiJobId, failure: LlmFailure): Decision {
  switch (failure.kind) {
    case "rate_limited":
      return { outcome: deferred(failure.retryAfterSeconds), job: { status: "failed", errorCode: "provider_rate_limited" } };
    case "misconfigured":
      return { outcome: deferred(null), job: { status: "failed", errorCode: "provider_misconfigured" } };
    case "timeout":
      return failed(jobId, "transient", "provider_timeout");
    case "unavailable":
      return failed(jobId, "transient", "provider_unavailable");
    case "rejected":
      return failed(jobId, "provider_rejected", "provider_rejected");
    case "malformed_response":
      return failed(jobId, "provider_rejected", "provider_malformed_response");
  }
}

function assertOutputCap(maxOutputTokens: number): void {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > MAX_OUTPUT_TOKENS) {
    throw new RangeError("maxOutputTokens must be an integer from 1 to 1200");
  }
}

/**
 * The K10 execution controller (workflow/contracts.md §13, §24, §25; D-61–D-69, D-73–D-78). `run` must be called
 * with no Tx open. Its own transactions are short, and none is open while the provider is called (AI-03). It never
 * throws except for an invalid `maxOutputTokens` (D-68, D-75), and never logs prompts, content or provider errors.
 */
export function createAiExecutionController(deps: AiExecutionControllerDeps): AiExecutionController {
  const { database, rateLimiter, socRequestKey, provider, limits, random, clock, sleep } = deps;
  const leases = createSchedulerLeaseRepository({ sql: deps.sql });
  const budgets = createAiBudgetRepository({ sql: deps.sql });
  const jobs = createAiJobRepository({ sql: deps.sql });
  const socRequests: RateLimitPolicy = { limit: limits.requestsPerMinute, windowSeconds: SOC_REQUESTS_WINDOW_SECONDS };

  /**
   * Step 1 (D-63, D-66, D-73, D-77), in P-13 order: the lease, budget days, reservations, then jobs. An `ok` result
   * commits: a started job, or a budget deferral that keeps the expiry. An error result rolls everything back.
   */
  async function stepOne<T>(tx: Tx, request: AiExecutionRequest<T>, reserved: number): Promise<Result<Start, Start>> {
    const lease = await leases.lock(tx, AI_EXECUTION_LEASE);
    if (lease.held) {
      return { ok: false, error: stopped(deferred(lease.retryAfterSeconds)) };
    }
    const today = await budgets.ensureToday(tx, limits.dailyBudgetMicrodollars);
    const cutoff = await budgets.lockDaysForExpiry(tx, today.budgetDay);
    await budgets.applyConfiguredBudget(tx, today.budgetDay, limits.dailyBudgetMicrodollars);
    await budgets.settleAbandoned(tx, cutoff, limits.maxAttempts);
    await jobs.expireLapsed(tx, cutoff);
    if (!(await budgets.reserve(tx, today.budgetDay, reserved))) {
      return { ok: true, value: stopped(deferred(today.secondsToNextDay)) };
    }
    const taken = await leases.take(tx, AI_EXECUTION_LEASE, limits.executionDeadlineMs + LEASE_MARGIN_MS);
    const { messages, snapshot } = request.input;
    const inserted = await jobs.insertRunning(
      tx,
      newAiJob(request.job, messages, snapshot, provider.modelId, taken.leaseUntil),
    );
    if (!inserted.inserted) {
      return { ok: false, error: stopped({ kind: "duplicate", jobId: inserted.runningJobId as AiJobId }) };
    }
    await budgets.insertReservation(tx, inserted.jobId, today.budgetDay, reserved);
    return { ok: true, value: { kind: "started", jobId: inserted.jobId as AiJobId, leaseToken: taken.leaseToken } };
  }

  /** The slot pre-check (D-77), the first `soc_requests` unit (D-62) and step 1. Any fault defers (D-75). */
  async function begin<T>(request: AiExecutionRequest<T>, reserved: number): Promise<Start> {
    try {
      const slot = await database.withTransaction((tx) => leases.peek(tx, AI_EXECUTION_LEASE));
      if (slot.held) {
        return stopped(deferred(slot.retryAfterSeconds));
      }
      const unit = await rateLimiter.consume(socRequestKey, socRequests, 1);
      if (!unit.allowed) {
        return stopped(deferred(unit.retryAfterSeconds));
      }
      const step = await database.withTransactionResult((tx) => stepOne(tx, request, reserved));
      return step.ok ? step.value : step.error;
    } catch {
      return stopped(deferred(null));
    }
  }

  /** The second attempt's unit (D-62). A denial or a fault means no second attempt. */
  async function consumeRetryUnit(): Promise<boolean> {
    try {
      return (await rateLimiter.consume(socRequestKey, socRequests, 1)).allowed;
    } catch {
      return false;
    }
  }

  /** D-61, D-69: the delay before retrying `last`, or `null` when it is not retried. */
  function backoffMs(last: Result<LlmCompletion, LlmFailure>): number | null {
    if (last.ok) {
      return null;
    }
    switch (last.error.kind) {
      case "rate_limited":
        return last.error.retryAfterSeconds === null
          ? JITTER_MIN_MS + random() * JITTER_SPAN_MS
          : last.error.retryAfterSeconds * 1_000;
      case "timeout":
      case "unavailable":
        return JITTER_MIN_MS + random() * JITTER_SPAN_MS;
      case "rejected":
      case "malformed_response":
      case "misconfigured":
        return null;
    }
  }

  /** One provider request with no Tx open, aborted after `timeoutMs`. Never rejects. */
  async function sendOnce<T>(request: AiExecutionRequest<T>, timeoutMs: number): Promise<Result<LlmCompletion, LlmFailure>> {
    const attempt = new AbortController();
    const timer = new AbortController();
    let finished = false;
    void sleep(timeoutMs, timer.signal).then(() => {
      if (!finished) {
        attempt.abort();
      }
    });
    try {
      return await provider.complete({
        messages: request.input.messages,
        maxOutputTokens: request.maxOutputTokens,
        signal: attempt.signal,
      });
    } catch {
      // The provider contract says `complete` never rejects; fail closed if one does.
      return UNAVAILABLE;
    } finally {
      finished = true;
      timer.abort();
    }
  }

  /** D-61, D-62, D-65, D-76: at most `maxAttempts` requests, each ending by the attempt end point. */
  async function sendAttempts<T>(request: AiExecutionRequest<T>, deadline: number): Promise<Attempts> {
    const attemptEnd = deadline - STORAGE_MARGIN_MS;
    const charges: AttemptCharge[] = [];
    let last: Result<LlmCompletion, LlmFailure> | null = null;
    while (charges.length < limits.maxAttempts) {
      if (last !== null) {
        const delay = backoffMs(last);
        if (delay === null || clock() + delay + MIN_ATTEMPT_WINDOW_MS > attemptEnd) {
          break;
        }
        await sleep(delay);
        if (!(await consumeRetryUnit())) {
          break;
        }
      }
      const remaining = attemptEnd - clock();
      if (remaining < MIN_ATTEMPT_WINDOW_MS) {
        break;
      }
      last = await sendOnce(request, Math.min(limits.attemptTimeoutMs, remaining));
      charges.push(attemptCharge(last, limits.prices));
    }
    return { last, charges };
  }

  /**
   * The publish Tx (P-08, D-73): the caller's callback takes its domain locks, then the guarded UPDATE sets the
   * job `succeeded`. A stale callback or a lost lease rolls back; any other fault is `storage_failed` (D-75).
   */
  async function publish<T>(request: AiExecutionRequest<T>, output: T, jobId: AiJobId, attemptCount: number): Promise<Decision> {
    try {
      const published = await database.withTransactionResult<void, "publish_stale" | "lease_expired">(async (tx) => {
        const result = await request.publish(tx, output, { jobId });
        if (!result.ok) {
          return { ok: false, error: "publish_stale" };
        }
        return (await jobs.markSucceeded(tx, jobId, attemptCount))
          ? { ok: true, value: undefined }
          : { ok: false, error: "lease_expired" };
      });
      return published.ok
        ? { outcome: { kind: "published", jobId }, job: null }
        : { outcome: { kind: "stale", jobId }, job: { status: "stale", errorCode: published.error } };
    } catch {
      return failed(jobId, "transient", "storage_failed");
    }
  }

  /** Steps 4 and 5: `validate`, then publish only when the publish Tx can start before the deadline (D-65). */
  async function decide<T>(request: AiExecutionRequest<T>, jobId: AiJobId, attempts: Attempts, deadline: number): Promise<Decision> {
    const { last } = attempts;
    if (last === null) {
      return failed(jobId, "transient", "deadline_exceeded");
    }
    if (!last.ok) {
      return fromFailure(jobId, last.error);
    }
    let validated: ReturnType<AiExecutionRequest<T>["validate"]>;
    try {
      validated = request.validate(last.value.content);
    } catch {
      return failed(jobId, "transient", "storage_failed");
    }
    if (!validated.ok) {
      return failed(jobId, "invalid_output", "invalid_output");
    }
    if (clock() >= deadline) {
      return failed(jobId, "transient", "deadline_exceeded");
    }
    return publish(request, validated.value, jobId, attempts.charges.length);
  }

  /**
   * The settlement Tx always runs (D-65), in P-13 order: release the slot by token, settle the reservation once,
   * then write `failed` or `stale` only where the job is still running (D-63, D-73). A fault leaves the decided
   * outcome unchanged; the next step 1 recovers the lease, reservation and job (D-75).
   */
  async function settle(start: { readonly jobId: AiJobId; readonly leaseToken: string }, attempts: Attempts, decision: Decision, reserved: number): Promise<void> {
    const settlement = planSettlement(attempts.charges, reserved);
    try {
      await database.withTransaction(async (tx) => {
        await leases.release(tx, AI_EXECUTION_LEASE, start.leaseToken);
        await budgets.settle(tx, start.jobId, settlement);
        if (decision.job !== null) {
          await jobs.markFinal(tx, start.jobId, { ...decision.job, attemptCount: attempts.charges.length });
        }
      });
    } catch {
      // Not retried (D-75).
    }
  }

  return {
    async run(request) {
      assertOutputCap(request.maxOutputTokens);
      const deadline = clock() + limits.executionDeadlineMs;

      const estimate = Math.max(estimateInputTokens(request.input.messages), Math.ceil(request.input.estimatedInputTokens));
      if (!(estimate <= limits.inputTokenLimit)) {
        return INPUT_TOO_LARGE;
      }
      const reserved = costMicrodollars(estimate, request.maxOutputTokens, limits.prices);
      if (reserved === null) {
        // Unreachable with validated configuration: the daily budget fits the largest reservation (D-78).
        return deferred(null);
      }

      const start = await begin(request, reserved);
      if (start.kind === "stopped") {
        return start.outcome;
      }
      const attempts = await sendAttempts(request, deadline);
      const decision = await decide(request, start.jobId, attempts, deadline);
      await settle(start, attempts, decision, reserved);
      return decision.outcome;
    },
  };
}
