import "server-only";

import type { AccountId, RequestId, Tx } from "../../shared";
import type { RateLimitName } from "../rate-limit/types";

// K5 vocabularies (workflow/contracts.md §8). Adding a value is a contract PR; the database leaves them open (D-33).
export const AUDIT_ACTIONS = [
  "account.suspend",
  "account.reinstate",
  "account.admin_provisioned",
  "movie.create",
  "movie.update",
  "movie.archive",
  "movie.restore",
  "review.approve",
  "review.hide",
  "review.restore",
  "review.auto_clear",
  "review.auto_flag",
  "report.accept",
  "report.dismiss",
  "announcement.create",
  "announcement.update",
  "announcement.publish",
  "announcement.unpublish",
  "announcement.delete",
] as const;
export const AUDIT_TARGET_TYPES = ["account", "movie", "review", "report", "announcement"] as const;
export const AUDIT_RESULTS = ["applied", "no_op"] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export interface AuditEntryInput {
  readonly actorId: AccountId | null; // null = system (automatic clearance, scheduler)
  readonly action: AuditAction;
  readonly targetType: AuditTargetType;
  readonly targetId: string; // UUID of the target
  readonly result: AuditResult;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>; // minimal before/after, admin reason
  readonly requestId: RequestId;
}

/** K5: insert-only, inside the caller's Tx. An invalid entry or a failed insert throws (D-46). */
export interface AuditLog {
  record(tx: Tx, entry: AuditEntryInput): Promise<void>;
}

// Security events (D-47, workflow/contracts.md §19 AM-10).
export type SecurityEvent =
  | "auth.login_failed"
  | "auth.login_throttled"
  | "auth.csrf_failed"
  | "access.denied"
  | "rate_limit.rejected"
  | "rate_limit.purge_failed";
export type SecurityOutcome = "failed" | "throttled" | "denied";

export interface SecurityEventInput {
  readonly event: SecurityEvent;
  readonly requestId: RequestId;
  readonly actorId?: AccountId;
  readonly limit?: RateLimitName;
  readonly code?: string; // api.md 8.1 error code
}

/** The fields of one security log line, and nothing else (D-47). */
export interface SecurityLogRecord {
  readonly event: SecurityEvent;
  readonly outcome: SecurityOutcome;
  readonly requestId: RequestId;
  readonly actorId?: AccountId;
  readonly limit?: RateLimitName;
  readonly code?: string;
}

export interface SecurityLog {
  /** Never throws. */
  record(entry: SecurityEventInput): void;
}
