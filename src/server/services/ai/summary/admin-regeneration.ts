import "server-only";

import type { Database } from "../../../db";
import type { ScheduleClock, SummarySelectionRepository } from "../../../repositories/summary";
import type {
  AccountId,
  AccountRole,
  FieldErrors,
  MovieId,
  RequestId,
  Result,
} from "../../../shared";
import type { AuditLog } from "../../audit";
import type { MovieLocks, ReviewsChangedMarker, SummarySchedule } from "../../catalogue";
import { RATE_LIMIT_POLICIES, type RateLimitKeys, type RateLimiter } from "../../rate-limit";
import type { AdminSummaryGeneration, SummaryGenerationOutcome } from "./generation";

export type AdminSummaryRegenerationStatus = "generated" | "pending" | "insufficient_reviews";

export type AdminSummaryRegenerationRejection =
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number };

export interface AdminSummaryRegenerationPrincipal {
  readonly accountId: AccountId;
  readonly role: AccountRole;
}

export interface AdminSummaryRegenerationLog {
  /** Identifiers and outcome category only; never provider detail, prompts, Review text, or output. */
  record(line: {
    readonly event: "summary.admin_regeneration_fault";
    readonly requestId: RequestId;
    readonly movieId: MovieId;
    readonly actorId: AccountId;
    readonly phase: "generation" | "release_backoff";
  }): void;
}

export interface AdminSummaryRegenerationService {
  regenerate(
    movieId: MovieId,
    principal: AdminSummaryRegenerationPrincipal,
    requestId: RequestId,
  ): Promise<Result<{ readonly status: AdminSummaryRegenerationStatus }, AdminSummaryRegenerationRejection>>;
}

export interface AdminSummaryRegenerationDependencies {
  readonly database: Pick<Database, "withTransaction" | "withTransactionResult">;
  readonly rateLimiter: Pick<RateLimiter, "consume">;
  readonly rateLimitKeys: Pick<RateLimitKeys, "forAccount">;
  readonly movieLocks: Pick<MovieLocks, "lockActiveMovieForUpdate">;
  readonly marker: Pick<ReviewsChangedMarker, "markReviewsChanged">;
  readonly schedule: Pick<SummarySchedule, "recordSummaryAttempt">;
  readonly clock: Pick<SummarySelectionRepository, "readScheduleClock">;
  readonly auditLog: AuditLog;
  /** Null when AI is disabled or unavailable; invalidation still commits and returns pending. */
  readonly generation: AdminSummaryGeneration | null;
  readonly log: AdminSummaryRegenerationLog;
}

export function parseAdminSummaryRegenerationInput(input: unknown): Result<Record<string, never>, FieldErrors> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: { body: ["must be an object"] } };
  }
  const fields = Object.keys(input);
  return fields.length === 0
    ? { ok: true, value: {} }
    : { ok: false, error: Object.fromEntries(fields.map((field) => [field, ["is not allowed"]])) };
}

export function createConsoleAdminSummaryRegenerationLog(): AdminSummaryRegenerationLog {
  return {
    record(line) {
      try {
        console.warn(JSON.stringify(line));
      } catch {
        // Observability must never alter the committed mutation or response.
      }
    },
  };
}

function responseStatus(outcome: SummaryGenerationOutcome): AdminSummaryRegenerationStatus {
  switch (outcome.kind) {
    case "published":
    case "current":
      return "generated";
    case "insufficient_reviews":
      return "insufficient_reviews";
    default:
      return "pending";
  }
}

function releasesBackoff(outcome: SummaryGenerationOutcome): boolean {
  return outcome.kind === "deferred" || outcome.kind === "disabled" || outcome.kind === "duplicate";
}

export function createAdminSummaryRegenerationService(
  deps: AdminSummaryRegenerationDependencies,
): AdminSummaryRegenerationService {
  async function resetNextAttempt(movieId: MovieId): Promise<void> {
    await deps.database.withTransaction(async (tx) => {
      const movie = await deps.movieLocks.lockActiveMovieForUpdate(tx, movieId);
      if (!movie.ok) return;
      const clock = await deps.clock.readScheduleClock(tx);
      await deps.schedule.recordSummaryAttempt(tx, movie.value, clock.now);
    });
  }

  return {
    async regenerate(movieId, principal, requestId) {
      if (principal.role !== "ADMIN") {
        return { ok: false, error: { kind: "forbidden" } };
      }

      const admission = await deps.rateLimiter.consume(
        deps.rateLimitKeys.forAccount("summary_regeneration", principal.accountId),
        RATE_LIMIT_POLICIES.summary_regeneration,
        1,
      );
      if (!admission.allowed) {
        return { ok: false, error: { kind: "rate_limited", retryAfterSeconds: admission.retryAfterSeconds } };
      }

      const invalidated = await deps.database.withTransactionResult<void, { readonly kind: "not_found" }>(
        async (tx) => {
          const movie = await deps.movieLocks.lockActiveMovieForUpdate(tx, movieId);
          if (!movie.ok) return { ok: false, error: { kind: "not_found" } };
          const revision = await deps.marker.markReviewsChanged(tx, movie.value);
          const clock: ScheduleClock = await deps.clock.readScheduleClock(tx);
          await deps.schedule.recordSummaryAttempt(tx, movie.value, clock.oneDayLater);
          await deps.auditLog.record(tx, {
            actorId: principal.accountId,
            action: "movie.summary_regenerate",
            targetType: "movie",
            targetId: movieId,
            result: "applied",
            metadata: { newReviewsRevision: revision },
            requestId,
          });
          return { ok: true, value: undefined };
        },
      );
      if (!invalidated.ok) return invalidated;

      let outcome: SummaryGenerationOutcome;
      try {
        outcome = deps.generation === null
          ? { kind: "disabled" }
          : await deps.generation.generateForAdmin(movieId, principal.accountId);
      } catch {
        deps.log.record({
          event: "summary.admin_regeneration_fault",
          requestId,
          movieId,
          actorId: principal.accountId,
          phase: "generation",
        });
        return { ok: true, value: { status: "pending" } };
      }

      if (releasesBackoff(outcome)) {
        try {
          await resetNextAttempt(movieId);
        } catch {
          deps.log.record({
            event: "summary.admin_regeneration_fault",
            requestId,
            movieId,
            actorId: principal.accountId,
            phase: "release_backoff",
          });
        }
      }
      return { ok: true, value: { status: responseStatus(outcome) } };
    },
  };
}
