import type { Database, Sql } from "../../src/server/db";

/**
 * Wraps a K1 database to observe transactions: how many are open right now, and an injected fault for the
 * next one that starts. Queries pass straight through, because a `Tx` from the inner database stays valid.
 */
export interface InstrumentedDatabase extends Database, Sql {
  /** Transactions started through this wrapper that have not yet committed or rolled back. */
  readonly openTransactions: number;
  /** Makes the next `withTransaction` or `withTransactionResult` call throw before it opens a transaction. */
  failNextTransaction(): void;
}

export function instrumentDatabase(inner: Database & Sql): InstrumentedDatabase {
  let open = 0;
  let failNext = false;

  async function tracked<T>(start: () => Promise<T>): Promise<T> {
    if (failNext) {
      failNext = false;
      throw new Error("injected transaction fault");
    }
    open += 1;
    try {
      return await start();
    } finally {
      open -= 1;
    }
  }

  return {
    get openTransactions() {
      return open;
    },
    failNextTransaction() {
      failNext = true;
    },
    withTransaction: (work) => tracked(() => inner.withTransaction(work)),
    withTransactionResult: (work) => tracked(() => inner.withTransactionResult(work)),
    probe: () => inner.probe(),
    query: (tx, text, params) => inner.query(tx, text, params),
  };
}
