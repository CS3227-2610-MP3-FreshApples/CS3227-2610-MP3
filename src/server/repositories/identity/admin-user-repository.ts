import "server-only";

import type { Sql, SqlParam } from "../../db";
import type { AccountId, AccountStatus, RowVersion, Tx } from "../../shared";
import type { AdminUserFilters } from "../../services/identity/account";

export interface AdminUserRecord {
  readonly id: AccountId;
  readonly displayName: string;
  readonly status: AccountStatus;
  readonly version: RowVersion;
}

export interface AdminUserRepository {
  list(tx: Tx, filters: AdminUserFilters, limit: number, offset: number): Promise<readonly AdminUserRecord[]>;
  count(tx: Tx, filters: AdminUserFilters): Promise<number>;
  findById(tx: Tx, accountId: AccountId): Promise<AdminUserRecord | null>;
}

interface AdminUserRow {
  readonly id: string;
  readonly display_name: string;
  readonly status: AccountStatus;
  readonly version: number;
}

const COLUMNS = "id, display_name, status, version";

function conditions(filters: AdminUserFilters): { readonly sql: string; readonly values: readonly SqlParam[] } {
  const clauses = ["role = 'USER'"];
  const values: SqlParam[] = [];
  if (filters.status !== null) {
    values.push(filters.status);
    clauses.push(`status = $${values.length}`);
  }
  if (filters.q !== null) {
    values.push(`%${escapeLikePattern(filters.q)}%`);
    clauses.push(`display_name ILIKE $${values.length} ESCAPE '\\'`);
  }
  return { sql: clauses.join(" AND "), values };
}

function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function toRecord(row: AdminUserRow): AdminUserRecord {
  return { id: row.id as AccountId, displayName: row.display_name, status: row.status, version: row.version as RowVersion };
}

export function createAdminUserRepository({ sql }: { readonly sql: Sql }): AdminUserRepository {
  return {
    async list(tx, filters, limit, offset) {
      const where = conditions(filters);
      const values = [...where.values, limit, offset];
      const rows = await sql.query<AdminUserRow>(
        tx,
        `SELECT ${COLUMNS} FROM app.account WHERE ${where.sql} ORDER BY lower(display_name) ASC, id ASC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      return rows.map(toRecord);
    },
    async count(tx, filters) {
      const where = conditions(filters);
      const rows = await sql.query<{ readonly total: number }>(tx, `SELECT count(*)::int AS total FROM app.account WHERE ${where.sql}`, where.values);
      return rows[0]?.total ?? 0;
    },
    async findById(tx, accountId) {
      const rows = await sql.query<AdminUserRow>(tx, `SELECT ${COLUMNS} FROM app.account WHERE id = $1 AND role = 'USER'`, [accountId]);
      return rows[0] === undefined ? null : toRecord(rows[0]);
    },
  };
}
