import "server-only";

import type { AccountId, AccountRole, AccountShareLock, AccountStatus, AccountUpdateLock, Result, RowVersion, Tx } from "../../shared";
import type { Sql } from "../../db";

export interface AccountRecord {
  readonly id: AccountId;
  readonly normalizedEmail: string;
  readonly passwordHash: string;
  readonly displayName: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly version: RowVersion;
  readonly strikeCycle?: number;
}

export interface NewAccount {
  readonly normalizedEmail: string;
  readonly passwordHash: string;
  readonly displayName: string;
}

export type AccountCreateFailure = { readonly kind: "conflict" };
export type AccountStatusUpdate = { readonly status: AccountStatus; readonly version: RowVersion; readonly strikeCycle: number };

export interface AccountRepository {
  create(tx: Tx, account: NewAccount): Promise<Result<AccountRecord, AccountCreateFailure>>;
  findByNormalizedEmail(tx: Tx, normalizedEmail: string): Promise<AccountRecord | null>;
  findById(tx: Tx, accountId: AccountId): Promise<AccountRecord | null>;
  lockActiveUserShared(tx: Tx, accountId: AccountId): Promise<AccountShareLock | null>;
  lockById(tx: Tx, accountId: AccountId): Promise<(AccountUpdateLock & { readonly role: AccountRole }) | null>;
  updateStatus(tx: Tx, account: AccountUpdateLock, status: AccountStatus, strikeCycle: number): Promise<AccountStatusUpdate>;
  lockAccountTableForFirstAdmin(tx: Tx): Promise<void>;
  countAdmins(tx: Tx): Promise<number>;
  createAdmin(tx: Tx, account: NewAccount): Promise<Result<AccountRecord, AccountCreateFailure>>;
}

interface AccountRow {
  id: string;
  normalized_email: string;
  password_hash: string;
  display_name: string;
  role: AccountRole;
  status: AccountStatus;
  version: number;
  strike_cycle: number;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export function createAccountRepository({ sql }: { readonly sql: Sql }): AccountRepository {
  return {
    async findByNormalizedEmail(tx, normalizedEmail) {
      const rows = await sql.query<AccountRow>(
        tx,
        `SELECT id, normalized_email, password_hash, display_name, role, status, version, strike_cycle
           FROM app.account
          WHERE normalized_email = $1`,
        [normalizedEmail],
      );
      return rows[0] === undefined ? null : toAccountRecord(rows[0]);
    },
    async lockAccountTableForFirstAdmin(tx) {
      await sql.query(tx, `LOCK TABLE app.account IN SHARE ROW EXCLUSIVE MODE`, []);
    },
    async countAdmins(tx) {
      const rows = await sql.query<{ count: number }>(tx, `SELECT count(*)::int AS count FROM app.account WHERE role = 'ADMIN'`, []);
      return rows[0]?.count ?? 0;
    },
    async findById(tx, accountId) {
      const rows = await sql.query<AccountRow>(
        tx,
        `SELECT id, normalized_email, password_hash, display_name, role, status, version, strike_cycle
           FROM app.account
          WHERE id = $1`,
        [accountId],
      );
      return rows[0] === undefined ? null : toAccountRecord(rows[0]);
    },
    async lockActiveUserShared(tx, accountId) {
      const rows = await sql.query<{ id: string }>(
        tx,
        `SELECT id
           FROM app.account
          WHERE id = $1 AND role = 'USER' AND status = 'active'
          FOR SHARE`,
        [accountId],
      );
      const row = rows[0];
      return row === undefined ? null : { accountId: row.id as AccountId } as AccountShareLock;
    },
    async lockById(tx, accountId) {
      const rows = await sql.query<AccountRow>(
        tx,
        `SELECT id, role, status, version, strike_cycle
           FROM app.account
          WHERE id = $1
          FOR UPDATE`,
        [accountId],
      );
      const row = rows[0];
      return row === undefined ? null : {
        accountId: row.id as AccountId,
        role: row.role,
        status: row.status,
        version: row.version as RowVersion,
        strikeCycle: row.strike_cycle,
      } as AccountUpdateLock & { readonly role: AccountRole };
    },
    async updateStatus(tx, account, status, strikeCycle) {
      const rows = await sql.query<{ status: AccountStatus; version: number; strike_cycle: number }>(
        tx,
        `UPDATE app.account
            SET status = $2, version = version + 1, strike_cycle = $3, updated_at = now()
          WHERE id = $1 AND version = $4
          RETURNING status, version, strike_cycle`,
        [account.accountId, status, strikeCycle, account.version],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("account status update returned no row");
      return { status: row.status, version: row.version as RowVersion, strikeCycle: row.strike_cycle };
    },
    async create(tx, account) {
      return insertAccount(sql, tx, account, "USER");
    },
    async createAdmin(tx, account) {
      return insertAccount(sql, tx, account, "ADMIN");
    },
  };
}

async function insertAccount(
  sql: Sql,
  tx: Tx,
  account: NewAccount,
  role: "USER" | "ADMIN",
): Promise<Result<AccountRecord, AccountCreateFailure>> {
      try {
        const rows = await sql.query<AccountRow>(
          tx,
          `INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
           VALUES ($1, $2, $3, $4, 'active')
           RETURNING id, normalized_email, password_hash, display_name, role, status, version, strike_cycle`,
          [account.normalizedEmail, account.passwordHash, account.displayName, role],
        );
        const row = rows[0];
        if (row === undefined) {
          throw new Error("account insert returned no row");
        }
        return { ok: true, value: toAccountRecord(row) };
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false, error: { kind: "conflict" } };
        }
        throw error;
      }
}

function toAccountRecord(row: AccountRow): AccountRecord {
  return {
    id: row.id as AccountId,
    normalizedEmail: row.normalized_email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    version: row.version as RowVersion,
    strikeCycle: row.strike_cycle,
  };
}
