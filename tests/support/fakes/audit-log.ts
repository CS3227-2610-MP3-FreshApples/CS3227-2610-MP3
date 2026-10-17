import type { AuditEntryInput, AuditLog } from "../../../src/server/services/audit";
import { parseAuditEntry } from "../../../src/server/services/audit/entry-schema";
import type { Tx } from "../../../src/server/shared";

export interface InMemoryAuditLog extends AuditLog {
  /** Every accepted entry, in call order. Rejected entries are never stored. */
  readonly entries: readonly AuditEntryInput[];
}

/**
 * K5 fake (workflow/contracts.md §8): an in-memory recorder that tests assert against. It validates with
 * the same D-46 schema as the real AuditLog, so an invalid entry throws here too, and it never drops one.
 * It has no transaction: a test that needs rollback behaviour uses PostgreSQL (D-10).
 */
export function createInMemoryAuditLog(): InMemoryAuditLog {
  const entries: AuditEntryInput[] = [];
  return {
    entries,
    async record(_tx: Tx, entry: AuditEntryInput): Promise<void> {
      parseAuditEntry(entry);
      entries.push(structuredClone(entry));
    },
  };
}
