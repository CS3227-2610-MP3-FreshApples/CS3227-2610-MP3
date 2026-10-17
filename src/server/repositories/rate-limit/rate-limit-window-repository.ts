import "server-only";

import type { Sql } from "../../db";
import type { Tx } from "../../shared";

export interface ConsumedWindow {
  /** Whether `count + units <= limit` held and the count grew by `units`. */
  readonly admitted: boolean;
  /** `ceil(window end − now())`, at least 1, from the database clock (D-43). */
  readonly retryAfterSeconds: number;
}

export interface PeekedWindow {
  /** The current window's count; 0 when it has no row. */
  readonly count: number;
  readonly retryAfterSeconds: number;
}

/** Access to app.rate_limit_window (D-12). Callers validate limits, windows and units first (D-43). */
export interface RateLimitWindowRepository {
  consume(tx: Tx, key: string, limit: number, windowSeconds: number, units: number): Promise<ConsumedWindow>;
  peek(tx: Tx, key: string, windowSeconds: number): Promise<PeekedWindow>;
  /** Deletes at most `maxRows` rows whose window started more than `olderThanSeconds` ago. */
  deleteExpired(tx: Tx, olderThanSeconds: number, maxRows: number): Promise<number>;
}

// The current window from the database clock, aligned to the Unix epoch (D-43). `$n` is the window length.
const clock = (windowSecondsParam: string) => `
  clock AS (
    SELECT now() AS now,
      to_timestamp(floor(extract(epoch FROM now()) / ${windowSecondsParam}::integer) * ${windowSecondsParam}::integer)
        AS window_start
  )`;

const retryAfterSeconds = (windowSecondsParam: string) => `
  greatest(1, ceil(
    extract(epoch FROM clock.window_start) + ${windowSecondsParam}::integer - extract(epoch FROM clock.now)
  ))::integer AS retry_after_seconds`;

// One atomic statement (D-43): the WHERE on DO UPDATE re-checks the latest committed count under the row
// lock, so concurrent callers cannot exceed the limit, and a rejected call leaves the count unchanged.
// A first call inserts `units`, which the caller has checked is at most `limit`.
const CONSUME = `
  WITH ${clock("$3")},
  admitted AS (
    INSERT INTO app.rate_limit_window AS w (bucket_key, window_start, count)
    SELECT $1, clock.window_start, $4::integer FROM clock
    ON CONFLICT (bucket_key, window_start) DO UPDATE SET count = w.count + EXCLUDED.count
      WHERE w.count + EXCLUDED.count <= $2::integer
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM admitted) AS admitted, ${retryAfterSeconds("$3")}
  FROM clock`;

const PEEK = `
  WITH ${clock("$2")}
  SELECT coalesce(
      (SELECT w.count FROM app.rate_limit_window AS w WHERE w.bucket_key = $1 AND w.window_start = clock.window_start),
      0
    ) AS count,
    ${retryAfterSeconds("$2")}
  FROM clock`;

const DELETE_EXPIRED = `
  WITH expired AS (
    SELECT bucket_key, window_start FROM app.rate_limit_window
    WHERE window_start < now() - make_interval(secs => $1::integer)
    ORDER BY window_start
    LIMIT $2::integer
  ),
  deleted AS (
    DELETE FROM app.rate_limit_window AS w USING expired AS e
    WHERE w.bucket_key = e.bucket_key AND w.window_start = e.window_start
    RETURNING 1
  )
  SELECT count(*)::integer AS deleted FROM deleted`;

function onlyRow<Row>(rows: readonly Row[]): Row {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("rate-limit statement returned no row");
  }
  return row;
}

export function createRateLimitWindowRepository(deps: { sql: Sql }): RateLimitWindowRepository {
  const { sql } = deps;
  return {
    async consume(tx, key, limit, windowSeconds, units) {
      const row = onlyRow(
        await sql.query<{ admitted: boolean; retry_after_seconds: number }>(tx, CONSUME, [key, limit, windowSeconds, units]),
      );
      return { admitted: row.admitted, retryAfterSeconds: row.retry_after_seconds };
    },
    async peek(tx, key, windowSeconds) {
      const row = onlyRow(await sql.query<{ count: number; retry_after_seconds: number }>(tx, PEEK, [key, windowSeconds]));
      return { count: row.count, retryAfterSeconds: row.retry_after_seconds };
    },
    async deleteExpired(tx, olderThanSeconds, maxRows) {
      return onlyRow(await sql.query<{ deleted: number }>(tx, DELETE_EXPIRED, [olderThanSeconds, maxRows])).deleted;
    },
  };
}
