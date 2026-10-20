import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import { createAccountRepository } from "../../../src/server/repositories/identity";
import { createAuditLog } from "../../../src/server/services/audit";
import { createFirstAdminBootstrapService } from "../../../src/server/services/identity";
import type { RequestId } from "../../../src/server/shared";
import { connectAsOwner } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";

const database: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const accounts = createAccountRepository({ sql: database });
const service = createFirstAdminBootstrapService({
  database,
  accountRepository: {
    lockAccountTableForFirstAdmin: accounts.lockAccountTableForFirstAdmin,
    countAdmins: accounts.countAdmins!,
    createAdmin: accounts.createAdmin!,
  },
  auditLog: createAuditLog({ sql: database }),
});

let owner: Client;

beforeAll(async () => {
  owner = await connectAsOwner();
});

beforeEach(async () => {
  await owner.query("TRUNCATE app.audit_entry, app.account RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await owner.end();
});

describe("First-Admin bootstrap — PostgreSQL", () => {
  it("serializes concurrent attempts and creates exactly one audited Admin", async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        service.bootstrap({
          email: "first-admin@example.test",
          password: "Synthetic-admin-password1!",
          requestId: randomUUID() as RequestId,
        }),
      ),
    );

    expect(results.filter((result) => result.ok && result.status === "created")).toHaveLength(1);
    expect(results.filter((result) => result.ok && result.status === "already_provisioned")).toHaveLength(2);
    const counts = await database.withTransaction(async (tx) => {
      const adminRows = await database.query<{ count: number }>(tx, "SELECT count(*)::int AS count FROM app.account WHERE role = 'ADMIN'", []);
      const auditRows = await database.query<{ count: number }>(tx, "SELECT count(*)::int AS count FROM app.audit_entry WHERE action = 'account.admin_provisioned'", []);
      return { admins: adminRows[0]?.count, audits: auditRows[0]?.count };
    });
    expect(counts).toEqual({ admins: 1, audits: 1 });

    const adminRows = await owner.query<{ normalized_email: string; password_hash: string }>(
      "SELECT normalized_email, password_hash FROM app.account WHERE role = 'ADMIN'",
    );
    expect(adminRows.rows).toHaveLength(1);
    expect(adminRows.rows[0]!.password_hash).toMatch(/^\$argon2id\$/);
    expect(adminRows.rows[0]!.password_hash).not.toContain("Synthetic-admin-password1!");

    const auditRows = await owner.query<{ before_after_metadata: Record<string, unknown> }>(
      "SELECT before_after_metadata FROM app.audit_entry WHERE action = 'account.admin_provisioned'",
    );
    expect(auditRows.rows).toEqual([{ before_after_metadata: { role: "ADMIN", status: "active" } }]);
    expect(JSON.stringify(auditRows.rows)).not.toContain(adminRows.rows[0]!.normalized_email);
    expect(JSON.stringify(auditRows.rows)).not.toContain("Synthetic-admin-password1!");
  });

  it("is idempotent after success even when credentials differ", async () => {
    await expect(service.bootstrap({
      email: "first-admin@example.test",
      password: "Synthetic-admin-password1!",
      requestId: randomUUID() as RequestId,
    })).resolves.toEqual({ ok: true, status: "created" });

    const result = await service.bootstrap({
      email: "different-admin@example.test",
      password: "Different-admin-password1!",
      requestId: randomUUID() as RequestId,
    });

    expect(result).toEqual({ ok: true, status: "already_provisioned" });
    await expect(
      database.withTransaction(async (tx) => {
        const rows = await database.query<{ count: number }>(tx, "SELECT count(*)::int AS count FROM app.account WHERE role = 'ADMIN'", []);
        expect(rows[0]?.count).toBe(1);
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects invalid bootstrap configuration before opening a transaction", async () => {
    const invalid = await service.bootstrap({
      email: "not-an-email",
      password: "short",
      requestId: randomUUID() as RequestId,
    });

    expect(invalid).toEqual({ ok: false, error: "invalid_fields" });
    const { rows } = await owner.query<{ count: number }>("SELECT count(*)::int AS count FROM app.account");
    expect(rows[0]?.count).toBe(0);
  });

  it("rolls back the Admin and audit entry when the audit path fails", async () => {
    const failingService = createFirstAdminBootstrapService({
      database,
      accountRepository: {
        lockAccountTableForFirstAdmin: accounts.lockAccountTableForFirstAdmin,
        countAdmins: accounts.countAdmins,
        createAdmin: accounts.createAdmin,
      },
      auditLog: { record: vi.fn().mockRejectedValue(new Error("synthetic audit failure")) },
    });

    await expect(failingService.bootstrap({
      email: "first-admin@example.test",
      password: "Synthetic-admin-password1!",
      requestId: randomUUID() as RequestId,
    })).rejects.toMatchObject({ name: "ServiceUnavailableError" });

    const { rows } = await owner.query<{ admins: number; audits: number }>(
      `SELECT
         (SELECT count(*)::int FROM app.account WHERE role = 'ADMIN') AS admins,
         (SELECT count(*)::int FROM app.audit_entry WHERE action = 'account.admin_provisioned') AS audits`,
    );
    expect(rows[0]).toEqual({ admins: 0, audits: 0 });
  });

  it("never promotes a conflicting USER email", async () => {
    await owner.query(
      `INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
       VALUES ('first-admin@example.test', 'synthetic-hash', 'Existing User', 'USER', 'active')`,
    );

    await expect(service.bootstrap({
      email: "FIRST-ADMIN@example.test",
      password: "Synthetic-admin-password1!",
      requestId: randomUUID() as RequestId,
    })).resolves.toEqual({ ok: false, error: "conflict" });

    const { rows } = await owner.query<{ role: string; audits: number }>(
      `SELECT role,
              (SELECT count(*)::int FROM app.audit_entry WHERE action = 'account.admin_provisioned') AS audits
         FROM app.account
        WHERE normalized_email = 'first-admin@example.test'`,
    );
    expect(rows).toEqual([{ role: "USER", audits: 0 }]);
  });
});
