import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { Pool, type PoolClient } from "pg";

import { TransactionConflict, type Result, type Tx } from "../shared";
import { POOL_TYPES } from "./type-parsers";
import type { Database, DatabaseConfig, Sql, SqlParam } from "./types";

// Values from tech-stack "Database driver" and architecture 6.5.
const MAX_CONNECTIONS = 1;
const CONNECTION_ACQUIRE_TIMEOUT_MS = 5_000;
const SET_STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '5s'";
const PROBE_TIMEOUT_MS = 2_000;
const PROBE_QUERY = "SELECT 1";
/** Deadlock and serialization failure (D-36). */
const CONFLICT_SQLSTATES: ReadonlySet<string> = new Set(["40P01", "40001"]);
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface TxState {
  readonly client: PoolClient;
  open: boolean;
}

/** Carries an error Result out of `withTransaction` so it rolls back. Never escapes this module. */
class RollbackWith<E> {
  constructor(readonly result: { readonly ok: false; readonly error: E }) {}
}

function parseDatabaseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    // The message must not echo the URL: it contains the database password.
    throw new Error("database URL is not a valid URL");
  }
}

function validateConfig(config: DatabaseConfig): void {
  const url = parseDatabaseUrl(config.url);
  if ([...url.searchParams.keys()].some((key) => key.toLowerCase().startsWith("ssl"))) {
    throw new Error("database URL must not contain ssl* parameters; they override the driver's TLS options");
  }
  if (config.caCert === null && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("a database without DATABASE_CA_CERT must use a loopback host (D-30)");
  }
}

function createPool(config: DatabaseConfig): Pool {
  const pool = new Pool({
    connectionString: config.url,
    max: MAX_CONNECTIONS,
    connectionTimeoutMillis: CONNECTION_ACQUIRE_TIMEOUT_MS,
    ssl: config.caCert === null ? false : { ca: config.caCert, rejectUnauthorized: true },
    types: POOL_TYPES,
  });
  // An idle connection that fails is already removed by the pool, and the next acquire opens a new one.
  // Without a listener the pool's "error" event would crash the server instance.
  pool.on("error", () => undefined);
  return pool;
}

function isConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return typeof error.code === "string" && CONFLICT_SQLSTATES.has(error.code);
}

async function rollbackAndRelease(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
    client.release();
  } catch (error) {
    // The connection state is unknown, so destroy it instead of returning it to the pool.
    client.release(error instanceof Error ? error : true);
  }
}

function rejectAfter(ms: number, message: string): { expired: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  expired.catch(() => undefined);
  return { expired, cancel: () => clearTimeout(timer) };
}

/**
 * Creates the K1 database (workflow/contracts.md §4): one pool of at most one connection, ready to use.
 * Throws if `config` would connect with TLS parameters in the URL or without TLS to a non-loopback host.
 */
export function createDatabase(config: DatabaseConfig): Database & Sql {
  validateConfig(config);
  const pool = createPool(config);
  // Per instance, not per module: tracks the transaction of the current async call chain (P-05).
  const currentTransaction = new AsyncLocalStorage<TxState>();
  const transactions = new WeakMap<Tx, TxState>();

  async function withTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    if (currentTransaction.getStore()?.open) {
      // With one connection, waiting for a second one would deadlock this request.
      throw new Error("nested withTransaction call inside an active transaction");
    }

    const client = await pool.connect();
    const state: TxState = { client, open: true };
    const tx = Object.freeze({}) as Tx;
    transactions.set(tx, state);

    try {
      await client.query("BEGIN");
      await client.query(SET_STATEMENT_TIMEOUT);
      const value = await currentTransaction.run(state, () => work(tx));
      state.open = false;
      await client.query("COMMIT");
      client.release();
      return value;
    } catch (error) {
      state.open = false;
      await rollbackAndRelease(client);
      throw isConflict(error) ? new TransactionConflict() : error;
    }
  }

  async function withTransactionResult<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    try {
      return await withTransaction(async (tx) => {
        const result = await work(tx);
        if (!result.ok) {
          throw new RollbackWith(result);
        }
        return result;
      });
    } catch (error) {
      if (error instanceof RollbackWith) {
        return error.result as Result<T, E>;
      }
      throw error;
    }
  }

  async function probe(): Promise<void> {
    const { expired, cancel } = rejectAfter(PROBE_TIMEOUT_MS, "database probe timed out");
    const acquiring = pool.connect();
    let client: PoolClient;
    try {
      client = await Promise.race([acquiring, expired]);
    } catch (error) {
      cancel();
      // A connection acquired after the deadline goes straight back to the pool.
      acquiring.then((late) => late.release(), () => undefined);
      throw error;
    }

    try {
      await Promise.race([client.query(PROBE_QUERY), expired]);
      client.release();
    } catch (error) {
      client.release(error instanceof Error ? error : true);
      throw error;
    } finally {
      cancel();
    }
  }

  async function query<Row>(tx: Tx, text: string, params: readonly SqlParam[]): Promise<readonly Row[]> {
    const state = transactions.get(tx);
    if (state === undefined || !state.open) {
      throw new Error("Tx is not open: it was committed, rolled back or created by another database");
    }
    // A config object without `name` keeps the statement unnamed (transaction pooler, SEC-05).
    const result = await state.client.query({ text, values: [...params] });
    return result.rows as Row[];
  }

  return { withTransaction, withTransactionResult, probe, query };
}
