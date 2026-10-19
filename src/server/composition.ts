import "server-only";

import { parseConfig, type AppConfig } from "./config";
import { createDatabase, type Database, type Sql } from "./db";
import {
  clientIpFromVercelHeaders,
  placeholderClientIp,
  type ClientIpResolver,
} from "./http";
import { createAuditLog, createConsoleSecurityLog, type AuditLog, type SecurityLog } from "./services/audit";
import { assessReadiness, type Readiness, type ReadinessInput } from "./services/health";
import { createRateLimiter, createRateLimitKeys, type RateLimiter, type RateLimitKeys } from "./services/rate-limit";
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
