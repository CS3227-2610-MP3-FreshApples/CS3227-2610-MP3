import "server-only";

import { parseConfig, type AppConfig } from "./config";
import { createDatabase, type Database, type Sql } from "./db";
import {
  createDeferredModerationDispatcher,
  createModerationWorkQueue,
  type ModerationDispatcher,
  type ModerationWorkQueue,
} from "./services/ai/moderation";
import { createDisabledAiExecutionController, type AiExecutionController } from "./services/ai/runtime";
import { createAuditLog, createConsoleSecurityLog, type AuditLog, type SecurityLog } from "./services/audit";
import {
  createMovieLocks,
  createReviewsChangedMarker,
  createSummarySchedule,
  type MovieLocks,
  type ReviewsChangedMarker,
  type SummarySchedule,
} from "./services/catalogue";
import { assessReadiness, type Readiness, type ReadinessInput } from "./services/health";
import { createRateLimiter, createRateLimitKeys, type RateLimiter, type RateLimitKeys } from "./services/rate-limit";

// The composition root (D-23): the only module-level instances in src/server, created once per server instance.

export const config: AppConfig = parseConfig(process.env);

/**
 * The single per-instance pool. `null` when core configuration is invalid, so readiness can report 503
 * instead of the instance failing to start (D-28).
 */
export const database: (Database & Sql) | null = config.core.valid ? createDatabase(config.core.value.database) : null;

/** K5 audit log (D-46); `null` exactly when `database` is. */
export const auditLog: AuditLog | null = database === null ? null : createAuditLog({ sql: database });

/** K6 shared rate limiter (D-43, D-45); `null` exactly when `database` is. */
export const rateLimiter: RateLimiter | null =
  database === null ? null : createRateLimiter({ database, sql: database });

/** K6 key builder (D-44), keyed with RATE_LIMIT_KEY_SECRET; `null` when core configuration is invalid. */
export const rateLimitKeys: RateLimitKeys | null = config.core.valid
  ? createRateLimitKeys({ secret: config.core.value.rateLimitKeySecret })
  : null;

/** K7 Movie lock functions (D-51); `null` exactly when `database` is. */
export const movieLocks: MovieLocks | null = database === null ? null : createMovieLocks({ sql: database });

/** K7 review-change marker (D-51); `null` exactly when `database` is. */
export const reviewsChangedMarker: ReviewsChangedMarker | null =
  database === null ? null : createReviewsChangedMarker({ sql: database });

/** K7 summary-schedule writes (O-20, D-51); `null` exactly when `database` is. */
export const summarySchedule: SummarySchedule | null =
  database === null ? null : createSummarySchedule({ sql: database });

/** K10 controller stub (D-52): returns `disabled` until S-06. No LLM provider is constructed before then. */
export const aiExecutionController: AiExecutionController = createDisabledAiExecutionController();

/** K9 ModerationWork queue (D-50); `null` exactly when `database` is. */
export const moderationWorkQueue: ModerationWorkQueue | null =
  database === null ? null : createModerationWorkQueue({ sql: database });

/** K9 dispatcher stub (D-52): returns `deferred` and writes nothing until B#7 (A-03) wires the real one. */
export const moderationDispatcher: ModerationDispatcher = createDeferredModerationDispatcher();

/** D-47 security-event log. It needs no configuration. */
export const securityLog: SecurityLog = createConsoleSecurityLog();

/** Readiness input (D-38): `database` is `null` exactly when core configuration is invalid. */
const readinessInput: ReadinessInput =
  config.core.valid && database !== null
    ? { probe: () => database.probe() }
    : { invalidCoreVariables: config.core.valid ? [] : config.core.issues.map((issue) => issue.variable) };

/** Readiness for GET /api/v1/health/ready (D-38). */
export const checkReadiness = (): Promise<Readiness> => assessReadiness(readinessInput);
