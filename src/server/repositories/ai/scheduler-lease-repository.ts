import "server-only";

import type { Sql } from "../../db";
import type { Tx } from "../../shared";

/** A named lease as the database clock sees it (D-66, D-67). */
export interface LeaseState {
  /** `lease_until` is later than `clock_timestamp()`. A missing row is free. */
  readonly held: boolean;
  /** Seconds until `lease_until`, rounded up, at least 1. Meaningful only while `held`. */
  readonly retryAfterSeconds: number;
}

export interface TakenLease {
  readonly leaseToken: string;
  readonly leaseUntil: Date;
}

/**
 * K10 access to app.scheduler_lease (D-13, D-66). Lease times are compared with `clock_timestamp()`, never `now()`
 * (D-73). Callers run these in K10's own short transactions, where the lease row is the first lock (P-13).
 */
export interface SchedulerLeaseRepository {
  /** Unlocked read (D-77). */
  peek(tx: Tx, name: string): Promise<LeaseState>;
  /** Inserts the row with an already-expired lease when it is missing, then locks it `FOR UPDATE` (D-66). */
  lock(tx: Tx, name: string): Promise<LeaseState>;
  /** Takes the locked lease with a new `lease_token` until `clock_timestamp()` + `leaseMs`. */
  take(tx: Tx, name: string, leaseMs: number): Promise<TakenLease>;
  /** Ends the lease only where `lease_token` still matches, so a taken-over lease is never released (D-66). */
  release(tx: Tx, name: string, leaseToken: string): Promise<void>;
}

const LEASE_STATE = `
  lease_until > clock_timestamp() AS held,
  greatest(1, ceil(extract(epoch FROM lease_until - clock_timestamp())))::integer AS retry_after_seconds`;

const PEEK = `SELECT ${LEASE_STATE} FROM app.scheduler_lease WHERE name = $1`;

const INSERT_EXPIRED = `
  INSERT INTO app.scheduler_lease (name, lease_token, lease_until)
  VALUES ($1, gen_random_uuid(), 'epoch')
  ON CONFLICT (name) DO NOTHING`;

const LOCK = `SELECT ${LEASE_STATE} FROM app.scheduler_lease WHERE name = $1 FOR UPDATE`;

const TAKE = `
  UPDATE app.scheduler_lease
  SET lease_token = gen_random_uuid(), lease_until = clock_timestamp() + $2::integer * interval '1 millisecond'
  WHERE name = $1
  RETURNING lease_token::text AS lease_token, lease_until`;

const RELEASE = `
  UPDATE app.scheduler_lease
  SET lease_until = least(lease_until, clock_timestamp())
  WHERE name = $1 AND lease_token = $2::uuid`;

interface LeaseStateRow {
  held: boolean;
  retry_after_seconds: number;
}

const FREE: LeaseState = Object.freeze({ held: false, retryAfterSeconds: 1 });

function toState(row: LeaseStateRow | undefined): LeaseState {
  return row === undefined ? FREE : { held: row.held, retryAfterSeconds: row.retry_after_seconds };
}

export function createSchedulerLeaseRepository(deps: { sql: Sql }): SchedulerLeaseRepository {
  const { sql } = deps;
  return {
    async peek(tx, name) {
      return toState((await sql.query<LeaseStateRow>(tx, PEEK, [name]))[0]);
    },
    async lock(tx, name) {
      await sql.query(tx, INSERT_EXPIRED, [name]);
      const row = (await sql.query<LeaseStateRow>(tx, LOCK, [name]))[0];
      if (row === undefined) {
        throw new Error("scheduler lease row missing after insert");
      }
      return toState(row);
    },
    async take(tx, name, leaseMs) {
      const row = (await sql.query<{ lease_token: string; lease_until: Date }>(tx, TAKE, [name, leaseMs]))[0];
      if (row === undefined) {
        throw new Error("scheduler lease row missing");
      }
      return { leaseToken: row.lease_token, leaseUntil: row.lease_until };
    },
    async release(tx, name, leaseToken) {
      await sql.query(tx, RELEASE, [name, leaseToken]);
    },
  };
}
