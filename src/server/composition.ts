import "server-only";

import { parseConfig, type AppConfig } from "./config";
import { createDatabase, type Database, type Sql } from "./db";
import { createAuditLog, createConsoleSecurityLog, type AuditLog, type SecurityLog } from "./services/audit";
import { assessReadiness, type Readiness, type ReadinessInput } from "./services/health";

// The composition root (D-23): the only module-level instances in src/server, created once per server instance.

export const config: AppConfig = parseConfig(process.env);

/**
 * The single per-instance pool. `null` when core configuration is invalid, so readiness can report 503
 * instead of the instance failing to start (D-28).
 */
export const database: (Database & Sql) | null = config.core.valid ? createDatabase(config.core.value.database) : null;

/** K5 audit log (D-46); `null` exactly when `database` is. */
export const auditLog: AuditLog | null = database === null ? null : createAuditLog({ sql: database });

/** D-47 security-event log. It needs no configuration. */
export const securityLog: SecurityLog = createConsoleSecurityLog();

/** Readiness input (D-38): `database` is `null` exactly when core configuration is invalid. */
const readinessInput: ReadinessInput =
  config.core.valid && database !== null
    ? { probe: () => database.probe() }
    : { invalidCoreVariables: config.core.valid ? [] : config.core.issues.map((issue) => issue.variable) };

/** Readiness for GET /api/v1/health/ready (D-38). */
export const checkReadiness = (): Promise<Readiness> => assessReadiness(readinessInput);
