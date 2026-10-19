import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import { createSessionRepository } from "../../../src/server/repositories/identity";
import { hashSessionToken } from "../../../src/server/services/identity/session";
import type { AccountId, SessionId } from "../../../src/server/shared";
import { connectAsOwner, insertAccount } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";
import type { Client } from "pg";

const database: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const sessionRepository = createSessionRepository({ sql: database });
let owner: Client;
let accountId: AccountId;

beforeAll(async () => {
  owner = await connectAsOwner();
  accountId = (await insertAccount(owner)) as AccountId;
});

afterAll(async () => {
  await owner.end();
});

describe("SessionRepository — PostgreSQL", () => {
  it("persists and retrieves only the hashed opaque token through app_runtime", async () => {
    const token = "synthetic-session-token";
    const hashedToken = hashSessionToken(token);
    const expiresAt = new Date("2026-10-17T08:00:00.000Z");
    const created = await database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      return sessionRepository.create(tx, { hashedToken, accountId, expiresAt });
    });

    expect(created.hashedToken).toEqual(hashedToken);
    expect(created.hashedToken.toString()).not.toContain(token);
    const persisted = await owner.query<{ hashed_token: Buffer }>(
      "SELECT hashed_token FROM app.session WHERE id = $1",
      [created.id],
    );
    expect(persisted.rows).toEqual([{ hashed_token: hashedToken }]);
    expect(persisted.rows[0]!.hashed_token.toString("utf8")).not.toContain(token);
    const found = await database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      return sessionRepository.findByHashedToken(tx, hashedToken);
    });
    expect(found).toMatchObject({ accountId, expiresAt });
    expect(found?.id).toEqual(created.id);

    await database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      await sessionRepository.deleteById(tx, created.id as SessionId);
    });
  });
});
