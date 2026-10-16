import "server-only";

import type { Sql } from "../../db";
import { createAuditEntryRepository } from "../../repositories/audit";
import { parseAuditEntry } from "./entry-schema";
import type { AuditLog } from "./types";

/**
 * K5 (workflow/contracts.md §8, §19 AM-09). Validates each entry (D-46) and inserts it inside the caller's
 * Tx as a later-table insert. A violation or a failed insert throws, so the whole mutation rolls back.
 */
export function createAuditLog(deps: { sql: Sql }): AuditLog {
  const repository = createAuditEntryRepository({ sql: deps.sql });
  return {
    async record(tx, entry) {
      const valid = parseAuditEntry(entry);
      await repository.insert(tx, {
        actorId: valid.actorId,
        action: valid.action,
        targetType: valid.targetType,
        targetId: valid.targetId,
        result: valid.result,
        metadataJson: JSON.stringify(valid.metadata),
        requestId: valid.requestId,
      });
    },
  };
}
