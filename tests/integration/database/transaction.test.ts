import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql, type SqlParam } from "../../../src/server/db";
import { TransactionConflict, type Result, type Tx } from "../../../src/server/shared";
import { testDatabaseUrl } from "./test-database";

// Synthetic scratch table in its own schema, so these tests do not depend on the application migration.
const SCHEMA = "k1_test";
const STATEMENT_TIMEOUT_TEST_MS = 15_000;

const url = testDatabaseUrl();
const db: Database & Sql = createDatabase({ url, caCert: null });

async function exec(text: string, params: readonly SqlParam[] = []): Promise<void> {
  await db.withTransaction((tx) => db.query(tx, text, params));
}

async function labels(): Promise<string[]> {
  const rows = await db.withTransaction((tx) =>
    db.query<{ label: string }>(tx, `SELECT label FROM ${SCHEMA}.item ORDER BY id`, []),
  );
  return rows.map((row) => row.label);
}

function insertItem(tx: Tx, id: number, label: string): Promise<readonly unknown[]> {
  return db.query(tx, `INSERT INTO ${SCHEMA}.item (id, label) VALUES ($1, $2)`, [id, label]);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await exec(`CREATE SCHEMA ${SCHEMA}`);
  await exec(`CREATE TABLE ${SCHEMA}.item (id integer PRIMARY KEY, label text NOT NULL, released date, amount bigint)`);
});

beforeEach(async () => {
  await exec(`TRUNCATE ${SCHEMA}.item`);
});

afterAll(async () => {
  await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
});

describe("withTransaction", () => {
  it("commits when work resolves", async () => {
    const value = await db.withTransaction(async (tx) => {
      await insertItem(tx, 1, "kept");
      return "done";
    });

    expect(value).toBe("done");
    expect(await labels()).toEqual(["kept"]);
  });

  it("rolls back and rethrows the same error when work throws", async () => {
    const failure = new Error("synthetic failure");

    await expect(
      db.withTransaction(async (tx) => {
        await insertItem(tx, 1, "discarded");
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await labels()).toEqual([]);
  });

  it("rolls back when a statement fails", async () => {
    await expect(
      db.withTransaction(async (tx) => {
        await insertItem(tx, 1, "discarded");
        await insertItem(tx, 1, "duplicate key");
      }),
    ).rejects.toMatchObject({ code: "23505" });

    expect(await labels()).toEqual([]);
  });

  it("runs with READ COMMITTED isolation and a 5 s local statement_timeout", async () => {
    const rows = await db.withTransaction((tx) =>
      db.query<{ isolation: string; timeout: string }>(
        tx,
        "SELECT current_setting('transaction_isolation') AS isolation, current_setting('statement_timeout') AS timeout",
        [],
      ),
    );

    expect(rows).toEqual([{ isolation: "read committed", timeout: "5s" }]);
  });

  it("queues sibling transactions on the single connection instead of rejecting them", async () => {
    await Promise.all([
      db.withTransaction((tx) => insertItem(tx, 1, "first")),
      db.withTransaction((tx) => insertItem(tx, 2, "second")),
    ]);

    expect(await labels()).toEqual(["first", "second"]);
  });
});

describe("withTransactionResult", () => {
  it("commits when work returns an ok Result", async () => {
    const result = await db.withTransactionResult<number, string>(async (tx) => {
      await insertItem(tx, 1, "kept");
      return { ok: true, value: 1 };
    });

    expect(result).toEqual({ ok: true, value: 1 });
    expect(await labels()).toEqual(["kept"]);
  });

  it("rolls back and returns the error Result when work returns one", async () => {
    const error: Result<number, string> = { ok: false, error: "synthetic_refusal" };

    const result = await db.withTransactionResult<number, string>(async (tx) => {
      await insertItem(tx, 1, "discarded");
      return error;
    });

    expect(result).toBe(error);
    expect(await labels()).toEqual([]);
  });

  it("rolls back and rethrows when work throws", async () => {
    const failure = new Error("synthetic failure");

    await expect(
      db.withTransactionResult(async (tx) => {
        await insertItem(tx, 1, "discarded");
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await labels()).toEqual([]);
  });
});

describe("nested transactions (P-05)", () => {
  it("rejects a nested withTransaction without running its work, and the outer can still commit", async () => {
    const innerWork = vi.fn(async () => undefined);

    await db.withTransaction(async (tx) => {
      await insertItem(tx, 1, "outer");
      await expect(db.withTransaction(innerWork)).rejects.toThrow(/nested/i);
    });

    expect(innerWork).not.toHaveBeenCalled();
    expect(await labels()).toEqual(["outer"]);
  });

  it("rejects a nested withTransactionResult", async () => {
    const innerWork = vi.fn(async (): Promise<Result<void, never>> => ({ ok: true, value: undefined }));

    await db.withTransaction(async () => {
      await expect(db.withTransactionResult(innerWork)).rejects.toThrow(/nested/i);
    });

    expect(innerWork).not.toHaveBeenCalled();
  });

  it("rejects the nested call before waiting for a connection", async () => {
    const started = Date.now();

    await db.withTransaction(async () => {
      await expect(db.withTransaction(async () => undefined)).rejects.toThrow(/nested/i);
    });

    // A nested call that waited for the pool would only fail after the 5 s acquire timeout.
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("Tx lifetime", () => {
  it("throws when a Tx is used after commit", async () => {
    let escaped: Tx | undefined;
    await db.withTransaction(async (tx) => {
      escaped = tx;
    });

    await expect(db.query(escaped!, "SELECT 1", [])).rejects.toThrow(/not open/i);
  });

  it("throws when a Tx is used after rollback", async () => {
    let escaped: Tx | undefined;
    await expect(
      db.withTransaction(async (tx) => {
        escaped = tx;
        throw new Error("synthetic failure");
      }),
    ).rejects.toThrow("synthetic failure");

    await expect(insertItem(escaped!, 1, "late write")).rejects.toThrow(/not open/i);
    expect(await labels()).toEqual([]);
  });

  it("throws when a Tx from another Database is used", async () => {
    const other = createDatabase({ url, caCert: null });

    await db.withTransaction(async (tx) => {
      await expect(other.query(tx, "SELECT 1", [])).rejects.toThrow(/not open/i);
    });
  });
});

describe("type parsing", () => {
  it("returns a date column as the raw YYYY-MM-DD string", async () => {
    const rows = await db.withTransaction(async (tx) => {
      await db.query(tx, `INSERT INTO ${SCHEMA}.item (id, label, released) VALUES (1, 'dated', '2024-02-29')`, []);
      return db.query<{ released: unknown; literal: unknown; list: unknown }>(
        tx,
        `SELECT released, DATE '0001-01-01' AS literal, ARRAY[DATE '1999-12-31', NULL]::date[] AS list FROM ${SCHEMA}.item`,
        [],
      );
    });

    expect(rows).toEqual([{ released: "2024-02-29", literal: "0001-01-01", list: ["1999-12-31", null] }]);
  });

  it("returns bigint values as numbers", async () => {
    const rows = await db.withTransaction((tx) =>
      db.query<{ amount: unknown; total: unknown; list: unknown }>(
        tx,
        "SELECT 9007199254740991::bigint AS amount, count(*) AS total, ARRAY[1, NULL, -2]::bigint[] AS list FROM (VALUES (1), (2)) AS v(n)",
        [],
      ),
    );

    expect(rows).toEqual([{ amount: Number.MAX_SAFE_INTEGER, total: 2, list: [1, null, -2] }]);
  });

  it("throws for a bigint above Number.MAX_SAFE_INTEGER", async () => {
    await expect(
      db.withTransaction((tx) => db.query(tx, "SELECT 9007199254740992::bigint AS amount", [])),
    ).rejects.toThrow(RangeError);
  });

  it("does not change the global pg type registry", async () => {
    const { types } = await import("pg");

    expect(types.getTypeParser(1082, "text")("2024-02-29")).toBeInstanceOf(Date);
    expect(types.getTypeParser(20, "text")("1")).toBe("1");
  });
});

describe("query", () => {
  it("binds parameters and never creates a named prepared statement", async () => {
    const rows = await db.withTransaction(async (tx) => {
      await insertItem(tx, 1, "it's; DROP TABLE item; --");
      await db.query(tx, `SELECT label FROM ${SCHEMA}.item WHERE id = $1 AND label = ANY($2)`, [1, ["a", "b"]]);
      return db.query<{ prepared: number }>(tx, "SELECT count(*) AS prepared FROM pg_prepared_statements", []);
    });

    expect(rows).toEqual([{ prepared: 0 }]);
    expect(await labels()).toEqual(["it's; DROP TABLE item; --"]);
  });
});

describe("statement timeout", () => {
  it(
    "cancels a statement that runs longer than 5 s and keeps the connection usable",
    async () => {
      const started = Date.now();

      await expect(db.withTransaction((tx) => db.query(tx, "SELECT pg_sleep(8)", []))).rejects.toMatchObject({
        code: "57014",
      });

      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(4_500);
      expect(elapsed).toBeLessThan(7_500);
      expect(await labels()).toEqual([]);
    },
    STATEMENT_TIMEOUT_TEST_MS,
  );
});

describe("transaction conflicts (D-36)", () => {
  it("converts a serialization failure (40001) into TransactionConflict without driver details", async () => {
    const error = await db
      .withTransaction(async (tx) => {
        await insertItem(tx, 1, "discarded");
        await db.query(tx, "DO $$ BEGIN RAISE EXCEPTION 'synthetic' USING ERRCODE = '40001'; END $$", []);
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TransactionConflict);
    expect(error).toMatchObject({ kind: "transaction_conflict" });
    expect(error).not.toHaveProperty("code");
    expect((error as Error).cause).toBeUndefined();
    expect((error as Error).message).not.toMatch(/synthetic/);
    expect(await labels()).toEqual([]);
  });

  it("converts a real deadlock (40P01) into TransactionConflict and does not retry", async () => {
    await exec(`INSERT INTO ${SCHEMA}.item (id, label) VALUES (1, 'one'), (2, 'two')`);
    // A second pool stands in for a second server instance; one pool has only one connection.
    const other = createDatabase({ url, caCert: null });
    const firstLocked = deferred();
    const secondLocked = deferred();
    let attempts = 0;
    const lock = (database: Database & Sql, tx: Tx, id: number) =>
      database.query(tx, `SELECT id FROM ${SCHEMA}.item WHERE id = $1 FOR UPDATE`, [id]);

    const outcomes = await Promise.allSettled([
      db.withTransaction(async (tx) => {
        attempts += 1;
        await lock(db, tx, 1);
        firstLocked.resolve();
        await secondLocked.promise;
        await lock(db, tx, 2);
      }),
      other.withTransaction(async (tx) => {
        attempts += 1;
        await lock(other, tx, 2);
        secondLocked.resolve();
        await firstLocked.promise;
        await lock(other, tx, 1);
      }),
    ]);

    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TransactionConflict);
    expect(attempts).toBe(2);
  });
});

describe("probe", () => {
  it("resolves when the database is reachable", async () => {
    await expect(db.probe()).resolves.toBeUndefined();
  });

  it("rejects within 2 s when the database is unreachable", async () => {
    const unreachable = createDatabase({ url: "postgresql://synthetic:synthetic@127.0.0.1:1/postgres", caCert: null });
    const started = Date.now();

    await expect(unreachable.probe()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_500);
  });
});

describe("createDatabase", () => {
  it.each(["sslmode=require", "sslmode=disable", "sslrootcert=/tmp/ca.pem", "ssl=true"])(
    "rejects a URL containing %s without echoing the URL",
    (query) => {
      const secretUrl = "postgresql://synthetic:synthetic-db-password@127.0.0.1:5432/postgres";

      expect(() => createDatabase({ url: `${secretUrl}?${query}`, caCert: null })).toThrow(/ssl/i);
      expect(() => createDatabase({ url: `${secretUrl}?${query}`, caCert: null })).not.toThrow(/synthetic-db-password/);
    },
  );

  it("rejects a non-loopback host without a CA certificate (D-30)", () => {
    expect(() =>
      createDatabase({ url: "postgresql://synthetic:synthetic@db.example.test:6543/postgres", caCert: null }),
    ).toThrow(/loopback/i);
  });

  it("is ready to use without any init step", async () => {
    const fresh = createDatabase({ url, caCert: null });

    await expect(fresh.withTransaction((tx) => fresh.query(tx, "SELECT 1 AS one", []))).resolves.toEqual([{ one: 1 }]);
  });
});
