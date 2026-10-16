import type { SecurityLog, SecurityLogRecord } from "../../../src/server/services/audit";
import { toSecurityLogRecord } from "../../../src/server/services/audit/security-log";

export interface RecordingSecurityLog extends SecurityLog {
  /** Every recorded event as the console implementation would write it, in call order. */
  readonly records: readonly SecurityLogRecord[];
}

/** D-47 fake (workflow/contracts.md §19 AM-10): records the same fields the console line carries. Never throws. */
export function createRecordingSecurityLog(): RecordingSecurityLog {
  const records: SecurityLogRecord[] = [];
  return {
    records,
    record(entry) {
      try {
        records.push(toSecurityLogRecord(entry));
      } catch {
        // Never throws (D-47).
      }
    },
  };
}
