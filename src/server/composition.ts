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
  createModerationDispatcher,
  createModerationWorkQueue,
  logUnreviewedPolicyIssue,
  PROFANITY_POLICY_VERSION,
  requiresDispatcherStub,
  type ModerationDispatcher,
  type ModerationRecovery,
  type ModerationWorkQueue,
} from "./services/ai/moderation";
import {
  createModerationReviewReadRepository,
  createModerationWorkRepository,
  createReviewModerationRepository,
} from "./repositories/ai";
import {
  createAiRuntime,
  type AiExecutionController,
  type AiRuntime,
  type SchedulerLeases,
} from "./services/ai/runtime";
import {
  createConsolePublicSummaryReadLog,
  createConsoleSummarySweepLog,
  createDisabledSummarySweep,
  createPublicSummaryReadService,
  createSummaryGeneration,
  createSummaryInputPreparation,
  createSummaryPublisher,
  createSummarySweep,
  systemSeedSource,
  type PublicSummaryReadService,
  type SummaryGeneration,
  type SummarySweep,
} from "./services/ai/summary";
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
import { createMovieArchiveService, type MovieArchiveService } from "./services/catalogue-archive";
import { createAdminAnnouncementService, type AdminAnnouncementService } from "./services/announcements";
import { createAnnouncementRepository } from "./repositories/announcements";
import { assessReadiness, type Readiness, type ReadinessInput } from "./services/health";
import { createRateLimiter, createRateLimitKeys, type RateLimiter, type RateLimitKeys } from "./services/rate-limit";
import { createAdminMovieRepository } from "./repositories/catalogue";
import { createAccountRepository, createSessionRepository } from "./repositories/identity";
import {
  createPublicSummaryReadRepository,
  createReviewSummaryRepository,
  createSummaryInputRepository,
  createSummarySelectionRepository,
} from "./repositories/summary";
import { createPublicMovieReadRepository } from "./repositories/catalogue";
import { createPublicAnnouncementReadRepository } from "./repositories/announcements";
import { createReviewRepository } from "./repositories/reviews";
import {
  createPublicCatalogueReadService,
  type PublicCatalogueReadService,
} from "./services/catalogue";
import {
  createPublicAnnouncementReadService,
  type PublicAnnouncementReadService,
} from "./services/announcements";
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
import {
  createReviewLocksAndReads,
  createReviewReadService,
  createReviewService,
  createReviewTransitions,
  type ReviewLocksAndReads,
  type ReviewReadService,
  type ReviewService,
  type ReviewTransitions,
} from "./services/reviews";

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

const reviewRepository = database === null ? null : createReviewRepository({ sql: database });

/** K8 review locks and screening reads (D-84), shared by review transitions and Movie archive. */
export const reviewLocks: ReviewLocksAndReads | null =
  database === null || movieLocks === null || reviewRepository === null
    ? null
    : createReviewLocksAndReads({ reviews: reviewRepository, movieLocks });

/** K8 review transition provider (D-84); callers own authorization, audit, and ModerationWork orchestration. */
export const reviewTransitions: ReviewTransitions | null =
  database === null || reviewsChangedMarker === null || reviewRepository === null
    ? null
    : createReviewTransitions({ reviews: reviewRepository, reviewsChangedMarker });

/** U-01 public catalogue reads; `null` exactly when the database is unavailable. */
export const publicCatalogueReadService: PublicCatalogueReadService | null =
  database === null
    ? null
    : createPublicCatalogueReadService({
        database,
        movies: createPublicMovieReadRepository({ sql: database }),
      });

/** U-01 public Announcement reads; `null` exactly when the database is unavailable. */
export const publicAnnouncementReadService: PublicAnnouncementReadService | null =
  database === null
    ? null
    : createPublicAnnouncementReadService({
          database,
          announcements: createPublicAnnouncementReadRepository({sql: database}),
      });

/** FR-05 Admin Movie reads and metadata writes; `null` exactly when `database` is. */
export const adminMovieService: AdminMovieService | null =
  database === null || auditLog === null
    ? null
    : createAdminMovieService({ database, movies: createAdminMovieRepository({ sql: database }), auditLog });

/** Movie archive/restore orchestrator (P-12, D-84); it shares K8's Movie-then-Review lock order. */
export const movieArchiveService: MovieArchiveService | null =
  database === null || auditLog === null || movieLocks === null || reviewsChangedMarker === null || reviewLocks === null
    ? null
    : createMovieArchiveService({
        database,
        movies: createAdminMovieRepository({ sql: database }),
        movieLocks,
        reviewLocks,
        marker: reviewsChangedMarker,
        auditLog,
      });

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

/**
 * U-04 summary generation (D-89, D-93): built only with the real controller's `summaryLimits` and a database;
 * otherwise `null`, and the sweep does nothing.
 */
export const summaryGeneration: SummaryGeneration | null =
  database === null || movieLocks === null || summarySchedule === null || aiRuntime.summaryLimits === null
    ? null
    : createSummaryGeneration({
        preparation: createSummaryInputPreparation({
          database,
          inputs: createSummaryInputRepository({ sql: database }),
          limits: aiRuntime.summaryLimits,
          seedSource: systemSeedSource,
        }),
        controller: aiRuntime.controller,
        publisher: createSummaryPublisher({
          movieLocks,
          schedule: summarySchedule,
          summaries: createReviewSummaryRepository({ sql: database }),
        }),
      });

/**
 * U-04 summary sweep (D-89, D-98): `null` exactly when `database` is. The real sweep needs summary generation,
 * the K10 sweep leases, K7 and AI configuration; otherwise the disabled sweep returns zero counts.
 */
export const summarySweep: SummarySweep | null =
  database === null
    ? null
    : summaryGeneration === null
        || schedulerLeases === null
        || movieLocks === null
        || summarySchedule === null
        || !config.ai.enabled
      ? createDisabledSummarySweep({ log: createConsoleSummarySweepLog() })
      : createSummarySweep({
          database,
          leases: schedulerLeases,
          selection: createSummarySelectionRepository({ sql: database }),
          movieLocks,
          schedule: summarySchedule,
          generation: summaryGeneration,
          limits: {
            intervalDays: config.ai.value.summaries.intervalDays,
            maxMoviesPerRun: config.ai.value.summaries.maxMoviesPerRun,
          },
          log: createConsoleSummarySweepLog(),
        });

/** FR-08 public summary read (D-90, D-98); `null` exactly when `database` is. It never calls K10. */
export const publicSummaryReadService: PublicSummaryReadService | null =
  database === null
    ? null
    : createPublicSummaryReadService({
        database,
        summaries: createPublicSummaryReadRepository({ sql: database }),
        log: createConsolePublicSummaryReadLog(),
      });

/** K9 ModerationWork queue (D-50); `null` exactly when `database` is. */
export const moderationWorkQueue: ModerationWorkQueue | null =
  database === null ? null : createModerationWorkQueue({ sql: database });

/**
 * The real K9 dispatcher, which also serves the recovery sweep (D-101). `null` without AI, the real K10 controller
 * (`schedulerLeases` is null exactly when the D-52 controller stub is wired) or the K8 and K5 dependencies, and
 * under D-56, which also logs its configuration issue once per instance.
 */
const moderationRecoveryDispatcher: (ModerationDispatcher & ModerationRecovery) | null = (() => {
  if (
    !config.ai.enabled
    || database === null
    || schedulerLeases === null
    || reviewLocks === null
    || reviewTransitions === null
    || auditLog === null
  ) {
    return null;
  }
  if (requiresDispatcherStub(config.ai.value.provider, PROFANITY_POLICY_VERSION)) {
    logUnreviewedPolicyIssue();
    return null;
  }
  return createModerationDispatcher({
    database,
    reviewLocks,
    transitions: reviewTransitions,
    work: createModerationWorkRepository({ sql: database }),
    reviewReads: createModerationReviewReadRepository({ sql: database }),
    results: createReviewModerationRepository({ sql: database }),
    auditLog,
    controller: aiRuntime.controller,
    settings: {
      modelId: config.ai.value.soc.model,
      inputTokenLimit: config.ai.value.execution.inputTokenLimit,
      maxExecutions: config.ai.value.moderation.maxExecutions,
    },
  });
})();

/** K9 dispatcher: the real one, or the D-52 stub that returns `deferred` and writes nothing (D-56, D-101). */
export const moderationDispatcher: ModerationDispatcher =
  moderationRecoveryDispatcher ?? createDeferredModerationDispatcher();

/** U-02 review creation/resubmission; `null` exactly when its database dependencies are unavailable. */
export const reviewService: ReviewService | null =
  database !== null && rateLimiter !== null && rateLimitKeys !== null && movieLocks !== null && reviewsChangedMarker !== null && moderationWorkQueue !== null && reviewRepository !== null
    ? createReviewService({
        database,
        accounts: createAccountRepository({ sql: database }),
        reviews: reviewRepository,
        movieLocks,
        reviewsChangedMarker,
        moderationWorkQueue,
        moderationDispatcher,
        rateLimiter,
        rateLimitKeys,
      })
    : null;

export const reviewReadService: ReviewReadService | null =
  database === null || reviewRepository === null ? null : createReviewReadService({ database, reviews: reviewRepository });

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
