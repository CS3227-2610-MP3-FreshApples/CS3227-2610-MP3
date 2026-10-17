import "server-only";

import type { SecurityEvent, SecurityEventInput, SecurityLog, SecurityLogRecord, SecurityOutcome } from "./types";

/** D-47 outcomes (thegrimbee, 16 October 2026). */
const OUTCOMES: Readonly<Record<SecurityEvent, SecurityOutcome>> = {
  "auth.login_failed": "failed",
  "auth.login_throttled": "throttled",
  "auth.csrf_failed": "denied",
  "access.denied": "denied",
  "rate_limit.rejected": "throttled",
  "rate_limit.purge_failed": "failed",
};

/**
 * Projects an event onto the D-47 fields only. Fields are copied one by one, so anything else a caller
 * passes (emails, IPs, errors) never reaches a line, and absent optional fields are omitted.
 */
export function toSecurityLogRecord(entry: SecurityEventInput): SecurityLogRecord {
  const { event, requestId, actorId, limit, code } = entry;
  return {
    event,
    outcome: OUTCOMES[event],
    requestId,
    ...(actorId === undefined ? {} : { actorId }),
    ...(limit === undefined ? {} : { limit }),
    ...(code === undefined ? {} : { code }),
  };
}

/** D-47: one JSON line per event with `console.warn`, kept in Vercel runtime logs. Never throws. */
export function createConsoleSecurityLog(): SecurityLog {
  return {
    record(entry) {
      try {
        console.warn(JSON.stringify(toSecurityLogRecord(entry)));
      } catch {
        // A security log line must never fail the request (D-47).
      }
    },
  };
}
