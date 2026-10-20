import "server-only";

import { parseConfig, type AppConfig } from "./config";
import { createDatabase, type Database, type Sql } from "./db";
import {
  clientIpFromVercelHeaders,
  placeholderClientIp,
  type ClientIpResolver,
} from "./http";
import {
  createDeferredModerationDispatcher,
  createModerationWorkQueue,
  type ModerationDispatcher,
  type ModerationWorkQueue,
} from "./services/ai/moderation";
import {
  createAiRuntime,
  type AiExecutionController,
  type AiRuntime,
  type SchedulerLeases,
} from "./services/ai/runtime";
import { createAuditLog, createConsoleSecurityLog, type AuditLog, type SecurityLog } from "./services/audit";
import {
  createAdminMovieService,
  createMovieLocks,
  createReviewsChangedMarker,
  createSummarySchedule,
  type AdminMovieService,
  type MovieLocks,
  type ReviewsChangedMarker,
  type SummarySchedule,
} from "./services/catalogue";
import type { MovieArchiveService } from "./services/catalogue-archive";
import { createAdminAnnouncementService, type AdminAnnouncementService } from "./services/announcements";
import { createAnnouncementRepository } from "./repositories/announcements";
import { assessReadiness, type Readiness, type ReadinessInput } from "./services/health";
import { createRateLimiter, createRateLimitKeys, type RateLimiter, type RateLimitKeys } from "./services/rate-limit";
import { createAdminMovieRepository } from "./repositories/catalogue";
import { createAccountRepository, createSessionRepository } from "./repositories/identity";
import {
  createAuthService,
  createAuthGuards,
  createAccountStatusService,
  createCsrfService,
  createFirstAdminBootstrapService,
  createIdentityService,
  createSessionService,
  type AuthService,
  type AuthGuards,
  type AccountStatusService,
  type FirstAdminBootstrapService,
} from "./services/identity";

// The composition root (D-23): the only module-level instances in src/server, created once per server instance.

export const config: AppConfig = parseConfig(process.env);

/** K2 client-IP dependency, selected once per server instance under D-44. */
export const clientIpResolver: ClientIpResolver =
  config.core.valid
    && (config.core.value.appEnv === "development" || config.core.value.appEnv === "production")
    ? clientIpFromVercelHeaders
    : placeholderClientIp;

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

/** FR-05 Admin Movie reads and metadata writes; `null` exactly when `database` is. */
export const adminMovieService: AdminMovieService | null =
  database === null || auditLog === null
    ? null
    : createAdminMovieService({ database, movies: createAdminMovieRepository({ sql: database }), auditLog });

/**
 * Movie archive/restore orchestrator (P-12, D-84). Unwired until U-02 (Developer A) provides K8
 * `lockReviewsOfMovie`; the archive and restore routes return 503 until then. Wire it with
 * `createMovieArchiveService` from ./services/catalogue-archive once K8 is on `master`.
 */
export const movieArchiveService: MovieArchiveService | null = null;

/** FR-07 Admin Announcement reads and writes; `null` exactly when `database` is. */
export const adminAnnouncementService: AdminAnnouncementService | null =
  database === null || auditLog === null
    ? null
    : createAdminAnnouncementService({
        database,
        announcements: createAnnouncementRepository({ sql: database }),
        auditLog,
      });

/**
 * The K10 runtime (D-71, D-78): with AI enabled and a database, the provider, the real controller and
 * SchedulerLeases; otherwise the D-52 controller stub and no provider.
 */
const aiRuntime: AiRuntime = createAiRuntime({
  ai: config.ai,
  platform:
    config.core.valid && database !== null && rateLimiter !== null && rateLimitKeys !== null
      ? { database, rateLimiter, rateLimitKeys, appEnv: config.core.value.appEnv }
      : null,
  fetch: (url, init) => fetch(url, init),
});

/** K10 execution controller: the real one, or the D-52 stub that returns `disabled`. */
export const aiExecutionController: AiExecutionController = aiRuntime.controller;

/** K10 sweep leases; `null` exactly when the D-52 controller stub is wired. */
export const schedulerLeases: SchedulerLeases | null = aiRuntime.schedulerLeases;

/** K9 ModerationWork queue (D-50); `null` exactly when `database` is. */
export const moderationWorkQueue: ModerationWorkQueue | null =
  database === null ? null : createModerationWorkQueue({ sql: database });

/** K9 dispatcher stub (D-52): returns `deferred` and writes nothing until B#7 (A-03) wires the real one. */
export const moderationDispatcher: ModerationDispatcher = createDeferredModerationDispatcher();

/** D-47 security-event log. It needs no configuration. */
export const securityLog: SecurityLog = createConsoleSecurityLog();

export const identityService = database !== null ? createIdentityService({ database, accountRepository: createAccountRepository({ sql: database }) }) : null;

/** K4 account-status service; `null` exactly when its database-backed repositories are unavailable. */
export const accountStatusService: AccountStatusService | null =
  database === null
    ? null
    : createAccountStatusService({
        accountRepository: createAccountRepository({ sql: database }),
        sessionRepository: createSessionRepository({ sql: database }),
      });

export const authService: AuthService | null =
  database !== null && rateLimiter !== null && rateLimitKeys !== null && config.core.valid
  ? (() => {
        const accounts = createAccountRepository({ sql: database });
        const sessions = createSessionRepository({ sql: database });
        return createAuthService({
          database,
          accountRepository: accounts,
          sessions: createSessionService({ database, sessionRepository: sessions, sessionTtlSeconds: config.core.value.sessionTtlSeconds }),
          rateLimiter,
          rateLimitKeys,
          securityLog,
        });
      })()
    : null;

export const csrfService = config.core.valid ? createCsrfService({ secret: config.core.value.sessionSecret }) : null;

export const authGuards: AuthGuards | null =
  authService !== null && csrfService !== null && config.core.valid
    ? createAuthGuards({
        authService,
        csrfService,
        securityLog,
        cronSecret: config.cron.enabled ? config.cron.secret : "",
        publicAppUrl: config.core.value.publicAppUrl,
        hosted: config.core.value.appEnv === "development" || config.core.value.appEnv === "production",
      })
    : null;

export const firstAdminBootstrapService: FirstAdminBootstrapService | null =
  database !== null && auditLog !== null
    ? (() => {
        const accounts = createAccountRepository({ sql: database });
        return createFirstAdminBootstrapService({
          database,
          accountRepository: {
            lockAccountTableForFirstAdmin: accounts.lockAccountTableForFirstAdmin,
            countAdmins: accounts.countAdmins,
            createAdmin: accounts.createAdmin,
          },
          auditLog,
        });
      })()
    : null;

/** Readiness input (D-38): `database` is `null` exactly when core configuration is invalid. */
const readinessInput: ReadinessInput =
  config.core.valid && database !== null
    ? {
        probe: () => database.probe(),
        adminProvisioned: async () => database.withTransaction((tx) => createAccountRepository({ sql: database }).countAdmins(tx).then((count) => count > 0)),
      }
    : { invalidCoreVariables: config.core.valid ? [] : config.core.issues.map((issue) => issue.variable) };

/** Readiness for GET /api/v1/health/ready (D-38). */
export const checkReadiness = (): Promise<Readiness> => assessReadiness(readinessInput);
