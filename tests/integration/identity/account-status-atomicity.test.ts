import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import { createAccountRepository, createSessionRepository } from "../../../src/server/repositories/identity";
import { createAuditLog } from "../../../src/server/services/audit";
import { createAccountStatusService } from "../../../src/server/services/identity";
import { hashSessionToken } from "../../../src/server/services/identity/session";
import type { AccountId, RequestId, Tx } from "../../../src/server/shared";
import { connectAsOwner, insertAccount } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";

const database: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const competingDatabase: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const accounts = createAccountRepository({ sql: database });
const sessions = createSessionRepository({ sql: database });
const status = createAccountStatusService({ accountRepository: accounts, sessionRepository: sessions });
const competingStatus = createAccountStatusService({
  accountRepository: createAccountRepository({ sql: competingDatabase }),
  sessionRepository: createSessionRepository({ sql: competingDatabase }),
});
const audit = createAuditLog({ sql: database });
const REQUEST_ID = randomUUID() as RequestId;

let owner: Client;
let adminId: AccountId;
let userId: AccountId;

beforeAll(async () => {
  owner = await connectAsOwner();
});

beforeEach(async () => {
  await owner.query("TRUNCATE app.session, app.audit_entry, app.account RESTART IDENTITY CASCADE");
  adminId = (await insertAccount(owner, "ADMIN")) as AccountId;
  userId = (await insertAccount(owner, "USER")) as AccountId;
});

afterAll(async () => {
  await owner.end();
});

async function countRows(table: "session" | "audit_entry"): Promise<number> {
  const { rows } = await owner.query<{ count: number }>(`SELECT count(*)::int AS count FROM app.${table}`);
  return rows[0]?.count ?? 0;
}

async function accountState(): Promise<{ status: string; version: number; strikeCycle: number }> {
  const { rows } = await owner.query<{ status: string; version: number; strike_cycle: number }>(
    "SELECT status, version, strike_cycle FROM app.account WHERE id = $1",
    [userId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("user fixture missing");
  return { status: row.status, version: row.version, strikeCycle: row.strike_cycle };
}

async function addSession(tx: Tx): Promise<void> {
  await sessions.create(tx, {
    hashedToken: hashSessionToken("synthetic-session-token"),
    accountId: userId,
    expiresAt: new Date(Date.now() + 60_000),
  });
}

async function suspendAndAudit(db: Database & Sql): Promise<void> {
  await db.withTransaction(async (tx) => {
    await db.query(tx, "SET LOCAL ROLE app_runtime", []);
    const locked = await status.lockUserAccount(tx, userId);
    if (!locked.ok) throw new Error("user fixture was not lockable");
    const change = await status.suspend(tx, locked.value);
    await audit.record(tx, {
      actorId: adminId,
      action: "account.suspend",
      targetType: "account",
      targetId: userId,
      result: change.changed ? "applied" : "no_op",
      metadata: { before: change.before, after: change.after, reason: "Synthetic status test." },
      requestId: REQUEST_ID,
    });
  });
}

describe("Identity account status transaction boundaries", () => {
  it("revokes sessions and writes the audit entry atomically on suspension", async () => {
    await database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      await addSession(tx);
    });

    await suspendAndAudit(database);

    expect(await accountState()).toEqual({ status: "suspended", version: 2, strikeCycle: 0 });
    expect(await countRows("session")).toBe(0);
    expect(await countRows("audit_entry")).toBe(1);
  });

  it("rolls back status, session deletion, and audit together", async () => {
    await database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      await addSession(tx);
    });

    await expect(database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      const locked = await status.lockUserAccount(tx, userId);
      if (!locked.ok) throw new Error("user fixture was not lockable");
      await status.suspend(tx, locked.value);
      await audit.record(tx, {
        actorId: adminId,
        action: "account.suspend",
        targetType: "account",
        targetId: userId,
        result: "applied",
        metadata: { reason: "Synthetic rollback." },
        requestId: REQUEST_ID,
      });
      throw new Error("synthetic rollback");
    })).rejects.toThrow("synthetic rollback");

    expect(await accountState()).toEqual({ status: "active", version: 1, strikeCycle: 0 });
    expect(await countRows("session")).toBe(1);
    expect(await countRows("audit_entry")).toBe(0);
  });

  it("advances the strike cycle on reinstatement without restoring revoked sessions", async () => {
    await database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      await addSession(tx);
      const active = await status.lockUserAccount(tx, userId);
      if (!active.ok) throw new Error("user fixture was not lockable for suspension");
      await status.suspend(tx, active.value);
    });

    await database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      const suspended = await status.lockUserAccount(tx, userId);
      if (!suspended.ok) throw new Error("user fixture was not lockable for reinstatement");
      await status.reinstate(tx, suspended.value);
    });

    expect(await accountState()).toEqual({ status: "active", version: 3, strikeCycle: 1 });
    expect(await countRows("session")).toBe(0);
  });

  it("serializes competing suspension attempts and makes the second one a no-op", async () => {
    const firstLocked = deferred();
    const releaseFirst = deferred();
    const first = database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      const locked = await status.lockUserAccount(tx, userId);
      if (!locked.ok) throw new Error("first lock failed");
      firstLocked.resolve();
      await releaseFirst.promise;
      return status.suspend(tx, locked.value);
    });

    await firstLocked.promise;
    const second = competingDatabase.withTransaction(async (tx) => {
      await competingDatabase.query(tx, "SET LOCAL ROLE app_runtime", []);
      const locked = await competingStatus.lockUserAccount(tx, userId);
      if (!locked.ok) throw new Error("second lock failed");
      return competingStatus.suspend(tx, locked.value);
    });

    releaseFirst.resolve();
    const [firstChange, secondChange] = await Promise.all([first, second]);

    expect(firstChange.changed).toBe(true);
    expect(secondChange.changed).toBe(false);
    expect(await accountState()).toEqual({ status: "suspended", version: 2, strikeCycle: 0 });
  });
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}
