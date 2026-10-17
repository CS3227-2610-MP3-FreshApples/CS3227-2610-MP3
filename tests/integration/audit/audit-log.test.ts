import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import { createAuditLog, type AuditEntryInput, type AuditLog } from "../../../src/server/services/audit";
import type { AccountId, Tx } from "../../../src/server/shared";
import { connectAsOwner, expectViolation, insertAccount } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";
import {
  describeAuditLogContract,
  REQUEST_ID,
  TARGET_ID,
  type StoredAuditEntry,
} from "../../support/contracts/audit-log.contract";

const INSUFFICIENT_PRIVILEGE = "42501";

interface AuditEntryRow {
  readonly actor_id: string | null;
  readonly action: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly result: string;
  readonly before_after_metadata: Record<string, unknown>;
  readonly request_id: string;
}

const db: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const auditLog: AuditLog = createAuditLog({ sql: db });
let owner: Client;
let actorId: AccountId;

beforeAll(async () => {
  owner = await connectAsOwner();
  actorId = (await insertAccount(owner, "ADMIN")) as AccountId;
});

afterEach(async () => {
  await owner.query("RESET ROLE");
});

afterAll(async () => {
  await owner.end();
});

/** Runs the record as the least-privilege runtime role (D-32), as production does. */
async function asRuntime(tx: Tx): Promise<void> {
  await db.query(tx, "SET LOCAL ROLE app_runtime", []);
}

async function storedEntries(): Promise<readonly StoredAuditEntry[]> {
  const { rows } = await owner.query<AuditEntryRow>(
    `SELECT actor_id, action, target_type, target_id, result, before_after_metadata, request_id
     FROM app.audit_entry ORDER BY created_at, id`,
  );
  return rows.map((row) => ({
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    result: row.result,
    metadata: row.before_after_metadata,
    requestId: row.request_id,
  }));
}

function entry(): AuditEntryInput {
  return {
    actorId,
    action: "account.suspend",
    targetType: "account",
    targetId: TARGET_ID,
    result: "applied",
    metadata: { reason: "Synthetic reason." },
    requestId: REQUEST_ID,
  } as AuditEntryInput;
}

describeAuditLogContract("PostgreSQL", async () => {
  await owner.query("TRUNCATE app.audit_entry");
  return {
    auditLog,
    actorId,
    record: (input) =>
      db.withTransaction(async (tx) => {
        await asRuntime(tx);
        await auditLog.record(tx, input);
      }),
    stored: storedEntries,
  };
});

describe("AuditLog — PostgreSQL transaction behaviour", () => {
  beforeAll(async () => {
    await owner.query("TRUNCATE app.audit_entry");
  });

  it("rolls the entry back with the caller's transaction", async () => {
    const failure = new Error("synthetic mutation failure");

    await expect(
      db.withTransaction(async (tx) => {
        await asRuntime(tx);
        await auditLog.record(tx, entry());
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await storedEntries()).toEqual([]);
  });

  it("rolls the caller's earlier writes back when the entry is invalid", async () => {
    await expect(
      db.withTransaction(async (tx) => {
        await asRuntime(tx);
        await auditLog.record(tx, entry());
        await auditLog.record(tx, { ...entry(), metadata: { token: "synthetic" } });
      }),
    ).rejects.toThrow("invalid audit entry");

    expect(await storedEntries()).toEqual([]);
  });

  it("takes created_at from the database clock", async () => {
    const before = await owner.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    await db.withTransaction(async (tx) => {
      await asRuntime(tx);
      await auditLog.record(tx, entry());
    });
    const after = await owner.query<{ now: Date }>("SELECT clock_timestamp() AS now");

    const { rows } = await owner.query<{ created_at: Date }>("SELECT created_at FROM app.audit_entry");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.created_at.getTime()).toBeGreaterThanOrEqual(before.rows[0]!.now.getTime());
    expect(rows[0]!.created_at.getTime()).toBeLessThanOrEqual(after.rows[0]!.now.getTime());
  });
});

describe("AuditLog — app_runtime cannot edit audit history (SEC-10)", () => {
  beforeAll(async () => {
    await owner.query("TRUNCATE app.audit_entry");
    await db.withTransaction(async (tx) => {
      await asRuntime(tx);
      await auditLog.record(tx, entry());
    });
  });

  it("cannot UPDATE audit rows", async () => {
    await owner.query("SET ROLE app_runtime");
    await expectViolation(owner.query("UPDATE app.audit_entry SET result = 'no_op'"), INSUFFICIENT_PRIVILEGE);
  });

  it("cannot DELETE audit rows", async () => {
    await owner.query("SET ROLE app_runtime");
    await expectViolation(owner.query("DELETE FROM app.audit_entry"), INSUFFICIENT_PRIVILEGE);
  });

  it("cannot TRUNCATE audit rows", async () => {
    await owner.query("SET ROLE app_runtime");
    await expectViolation(owner.query("TRUNCATE app.audit_entry"), INSUFFICIENT_PRIVILEGE);
  });

  it("leaves the row unchanged", async () => {
    expect(await storedEntries()).toMatchObject([{ action: "account.suspend", result: "applied" }]);
  });

  it("exposes no read, update or delete operation", () => {
    expect(Object.keys(auditLog)).toEqual(["record"]);
  });
});
