import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import { createAccountRepository } from "../../../src/server/repositories/identity";
import { createActingAccountLocks } from "../../../src/server/services/identity";
import type { AccountId } from "../../../src/server/shared";
import { connectAsOwner, insertAccount } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";

const database: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const competingDatabase: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const accountLocks = createActingAccountLocks({
  accountRepository: createAccountRepository({ sql: database }),
});

let owner: Client;

beforeAll(async () => {
  owner = await connectAsOwner();
});

beforeEach(async () => {
  await owner.query("TRUNCATE app.account RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await owner.end();
});

describe("K3 acting-User shared account lock", () => {
  it("returns a transaction-scoped share lock for an active User", async () => {
    const accountId = (await insertAccount(owner, "USER")) as AccountId;

    await expect(database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      return accountLocks.lockActiveUserShared(tx, accountId);
    })).resolves.toEqual({ ok: true, value: { accountId } });
  });

  it.each([
    ["missing", randomUUID() as AccountId],
    ["suspended", null],
    ["ADMIN", null],
  ])("rejects a %s account as forbidden", async (state, fixtureId) => {
    const accountId = fixtureId ?? (await insertAccount(owner, state === "ADMIN" ? "ADMIN" : "USER")) as AccountId;
    if (state === "suspended") {
      await owner.query("UPDATE app.account SET status = 'suspended' WHERE id = $1", [accountId]);
    }

    await expect(database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      return accountLocks.lockActiveUserShared(tx, accountId);
    })).resolves.toEqual({ ok: false, error: { kind: "forbidden" } });
  });

  it("holds the Account position-1 share lock against a competing status write", async () => {
    const accountId = (await insertAccount(owner, "USER")) as AccountId;
    const acquired = deferred();
    const release = deferred();

    const holder = database.withTransaction(async (tx) => {
      await database.query(tx, "SET LOCAL ROLE app_runtime", []);
      const result = await accountLocks.lockActiveUserShared(tx, accountId);
      if (!result.ok) throw new Error("active User fixture was not lockable");
      acquired.resolve();
      await release.promise;
      return result;
    });

    await acquired.promise;
    try {
      await expect(competingDatabase.withTransaction(async (tx) => {
        await competingDatabase.query(tx, "SET LOCAL ROLE app_runtime", []);
        await competingDatabase.query(tx, "SET LOCAL lock_timeout = '150ms'", []);
        await competingDatabase.query(
          tx,
          "UPDATE app.account SET status = 'suspended', version = version + 1 WHERE id = $1",
          [accountId],
        );
      })).rejects.toMatchObject({ code: "55P03" });
    } finally {
      release.resolve();
    }

    await expect(holder).resolves.toEqual({ ok: true, value: { accountId } });
    await expect(competingDatabase.withTransaction(async (tx) => {
      await competingDatabase.query(tx, "SET LOCAL ROLE app_runtime", []);
      await competingDatabase.query(
        tx,
        "UPDATE app.account SET status = 'suspended', version = version + 1 WHERE id = $1",
        [accountId],
      );
    })).resolves.toBeUndefined();
  });
});

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}
