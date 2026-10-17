import "server-only";

import type { Sql } from "../../db";
import type { Tx } from "../../shared";

/** One validated audit row. `metadataJson` is a JSON object string, because `SqlParam` has no object variant (AM-09). */
export interface AuditEntryRow {
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly result: string;
  readonly metadataJson: string;
  readonly requestId: string;
}

/** Insert-only access to app.audit_entry. There is no read, update or delete (D-46). */
export interface AuditEntryRepository {
  insert(tx: Tx, row: AuditEntryRow): Promise<void>;
}

const INSERT_AUDIT_ENTRY = `
  INSERT INTO app.audit_entry
    (actor_id, action, target_type, target_id, result, before_after_metadata, request_id, created_at)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, now())`;

export function createAuditEntryRepository(deps: { sql: Sql }): AuditEntryRepository {
  const { sql } = deps;
  return {
    async insert(tx, row) {
      await sql.query(tx, INSERT_AUDIT_ENTRY, [
        row.actorId,
        row.action,
        row.targetType,
        row.targetId,
        row.result,
        row.metadataJson,
        row.requestId,
      ]);
    },
  };
}
