import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import { createAdminUserRepository } from "../../../src/server/repositories/identity";
import type { AccountId } from "../../../src/server/shared";
import { connectAsOwner } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";

const database: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const users = createAdminUserRepository({ sql: database });
let owner: Client;

beforeAll(async () => { owner = await connectAsOwner(); });
afterAll(async () => { await owner.end(); });

async function insertAccount(displayName: string, role: "USER" | "ADMIN" = "USER"): Promise<string> {
  const result = await owner.query<{ id: string }>(
    "INSERT INTO app.account (normalized_email, password_hash, display_name, role, status) VALUES (gen_random_uuid()::text || '@example.test', 'synthetic-hash', $1, $2, 'active') RETURNING id",
    [displayName, role],
  );
  return result.rows[0]!.id;
}

describe("A-06 Admin user repository — PostgreSQL", () => {
  it("filters USER rows, treats search text literally, orders stably, and returns only the safe projection", async () => {
    const first = await insertAccount("alice");
    const second = await insertAccount("ALICE");
    await insertAccount("alice", "ADMIN");
    await insertAccount("percent%underscore_");

    const page = await database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      return users.list(tx, { status: null, q: "alice" }, 20, 0);
    });
    expect(page.map((user) => user.id)).toEqual([first as AccountId, second as AccountId].sort());
    expect(page.map((user) => user.displayName)).toEqual(expect.arrayContaining(["alice", "ALICE"]));
    expect(page[0]).toEqual(expect.objectContaining({ status: "active", version: 1 }));
    expect(Object.keys(page[0]!).sort()).toEqual(["displayName", "id", "status", "version"]);

    const wildcardCount = await database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      return users.count(tx, { status: null, q: "%" });
    });
    expect(wildcardCount).toBe(1);

    const literalMatch = await database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      return users.count(tx, { status: null, q: "percent%underscore_" });
    });
    expect(literalMatch).toBe(1);
  });

  it("excludes ADMIN accounts from detail reads", async () => {
    const adminId = await insertAccount("Admin account", "ADMIN");
    const result = await database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      return users.findById(tx, adminId as AccountId);
    });
    expect(result).toBeNull();
  });
});
