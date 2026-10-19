import "server-only";

import type { Sql } from "../../db";
import type { AccountId, SessionId, Tx } from "../../shared";

export interface SessionRecord {
  readonly id: SessionId;
  readonly hashedToken: Buffer;
  readonly accountId: AccountId;
  readonly expiresAt: Date;
}

export interface NewSession {
  readonly hashedToken: Buffer;
  readonly accountId: AccountId;
  readonly expiresAt: Date;
}

export interface SessionRepository {
  create(tx: Tx, session: NewSession): Promise<SessionRecord>;
  findByHashedToken(tx: Tx, hashedToken: Buffer): Promise<SessionRecord | null>;
  deleteById(tx: Tx, sessionId: SessionId): Promise<void>;
  deleteByAccountId(tx: Tx, accountId: AccountId): Promise<void>;
}

interface SessionRow {
  id: string;
  hashed_token: Buffer;
  account_id: string;
  expires_at: Date;
}

export function createSessionRepository({ sql }: { readonly sql: Sql }): SessionRepository {
  return {
    async create(tx, session) {
      const rows = await sql.query<SessionRow>(
        tx,
        `INSERT INTO app.session (hashed_token, account_id, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id, hashed_token, account_id, expires_at`,
        [session.hashedToken, session.accountId, session.expiresAt],
      );
      return toSessionRecord(onlyRow(rows));
    },
    async findByHashedToken(tx, hashedToken) {
      const rows = await sql.query<SessionRow>(
        tx,
        `SELECT id, hashed_token, account_id, expires_at
           FROM app.session
          WHERE hashed_token = $1`,
        [hashedToken],
      );
      return rows[0] === undefined ? null : toSessionRecord(rows[0]);
    },
    async deleteById(tx, sessionId) {
      await sql.query(tx, "DELETE FROM app.session WHERE id = $1", [sessionId]);
    },
    async deleteByAccountId(tx, accountId) {
      await sql.query(tx, "DELETE FROM app.session WHERE account_id = $1", [accountId]);
    },
  };
}

function onlyRow(rows: readonly SessionRow[]): SessionRow {
  const row = rows[0];
  if (row === undefined) throw new Error("session insert returned no row");
  return row;
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id as SessionId,
    hashedToken: row.hashed_token,
    accountId: row.account_id as AccountId,
    expiresAt: row.expires_at,
  };
}
