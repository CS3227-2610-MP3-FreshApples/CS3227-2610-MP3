import "server-only";

import type { Result, Tx } from "../shared";

/** The connection settings K1 needs; `CoreConfig.database` satisfies it. */
export interface DatabaseConfig {
  /** postgres:// URL with no ssl* query parameter (tech-stack "Database driver"). */
  readonly url: string;
  /** PEM CA certificate; `null` only for a loopback database in local/test (D-30). */
  readonly caCert: string | null;
}

/** K1 (workflow/contracts.md §4). Services receive `Database`; repositories receive `Sql`. */
export interface Database {
  /** Commits if `work` resolves; rolls back and rethrows if it throws. */
  withTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  /** Commits if `work` returns ok; rolls back if it returns an error Result or throws. */
  withTransactionResult<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>>;
  /** Readiness only (D-36): read-only query; resolves within 2 s including connection acquisition, else throws. */
  probe(): Promise<void>;
}

export type SqlParam = string | number | boolean | null | Date | readonly string[] | readonly number[];

export interface Sql {
  /** Unnamed parameterized query ($1, $2, …). Never sets a query `name`. Repositories only. */
  query<Row>(tx: Tx, text: string, params: readonly SqlParam[]): Promise<readonly Row[]>;
}
