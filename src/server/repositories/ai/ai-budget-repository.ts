import "server-only";

import type { Sql } from "../../db";
import type { Tx } from "../../shared";

/** Today's budget day, from the step-1 transaction time in UTC (D-78). */
export interface BudgetDay {
  /** `YYYY-MM-DD`. */
  readonly budgetDay: string;
  /** Seconds until the next UTC midnight, rounded up, at least 1 (D-67). */
  readonly secondsToNextDay: number;
}

/** How one reservation is settled (D-63). Token and actual columns are null when usage is unknown. */
export type ReservationSettlement =
  | { readonly status: "released"; readonly chargeMicrodollars: 0 }
  | {
      readonly status: "reconciled";
      readonly chargeMicrodollars: number;
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      readonly actualMicrodollars: number | null;
    };

/**
 * K10 access to app.ai_budget_day and app.ai_budget_reservation (D-13, D-25, D-63, D-73). Days are locked before
 * reservations (P-13), several days in ascending date order and several reservations in ascending ID order (D-66).
 * Every charge added to `consumed_microdollars` is capped at the day's headroom, so the budget check constraint
 * holds; the reservation row keeps the true amount (D-63). A reservation is settled at most once: only a row still
 * `reserved` changes, and the day moves only when it did (D-73).
 */
export interface AiBudgetRepository {
  /** Creates today's row with `configuredMicrodollars` when it is missing. Locks no existing row. */
  ensureToday(tx: Tx, configuredMicrodollars: number): Promise<BudgetDay>;
  /**
   * Captures `clock_timestamp()` as the expiry cutoff, then locks `FOR UPDATE`, in ascending date order, today's
   * row and the day of every `reserved` reservation whose AIJob lease ended by the cutoff. Returns the cutoff.
   */
  lockDaysForExpiry(tx: Tx, today: string): Promise<Date>;
  /** Sets today's budget to the larger of the configured value and reserved + consumed (D-63). Day locked. */
  applyConfiguredBudget(tx: Tx, today: string, configuredMicrodollars: number): Promise<void>;
  /**
   * Settles every `reserved` reservation whose AIJob lease ended by `cutoff`, whatever the job's status, as
   * `reconciled` with null usage at reserved × `maxAttempts` (D-73). Their days must be locked.
   */
  settleAbandoned(tx: Tx, cutoff: Date, maxAttempts: number): Promise<void>;
  /** Adds `amount` to today's reserved total when reserved + consumed + amount fits the budget. Day locked. */
  reserve(tx: Tx, today: string, amount: number): Promise<boolean>;
  /** Inserts the `reserved` row for a new AIJob, after the job (foreign key, D-73). */
  insertReservation(tx: Tx, jobId: string, budgetDay: string, amount: number): Promise<void>;
  /** Locks the reservation's day, then settles the reservation once against that day (D-63, D-73). */
  settle(tx: Tx, jobId: string, settlement: ReservationSettlement): Promise<void>;
}

const ENSURE_TODAY = `
  WITH today AS (SELECT (now() AT TIME ZONE 'UTC')::date AS budget_day),
  inserted AS (
    INSERT INTO app.ai_budget_day (budget_day, budget_microdollars)
    SELECT budget_day, $1::bigint FROM today
    ON CONFLICT (budget_day) DO NOTHING
  )
  SELECT budget_day,
    greatest(1, ceil(extract(epoch FROM ((budget_day + 1)::timestamp AT TIME ZONE 'UTC') - now())))::integer
      AS seconds_to_next_day
  FROM today`;

const LOCK_DAYS_FOR_EXPIRY = `
  WITH cutoff AS (SELECT clock_timestamp() AS at)
  SELECT cutoff.at AS cutoff
  FROM app.ai_budget_day AS day, cutoff
  WHERE day.budget_day = $1::date
    OR day.budget_day IN (
      SELECT reservation.budget_day
      FROM app.ai_budget_reservation AS reservation
      JOIN app.ai_job AS job ON job.id = reservation.ai_job_id
      WHERE reservation.status = 'reserved' AND job.lease_until <= cutoff.at
    )
  ORDER BY day.budget_day
  FOR UPDATE OF day`;

const APPLY_CONFIGURED_BUDGET = `
  UPDATE app.ai_budget_day
  SET budget_microdollars = greatest($2::bigint, reserved_microdollars + consumed_microdollars),
    version = version + 1
  WHERE budget_day = $1::date
    AND budget_microdollars <> greatest($2::bigint, reserved_microdollars + consumed_microdollars)`;

// The job row is read, never locked: K10 locks AIJob rows only through UPDATE (D-73).
const SETTLE_ABANDONED = `
  WITH abandoned AS (
    SELECT reservation.id
    FROM app.ai_budget_reservation AS reservation
    JOIN app.ai_job AS job ON job.id = reservation.ai_job_id
    WHERE reservation.status = 'reserved' AND job.lease_until <= $1::timestamptz
    ORDER BY reservation.id
    FOR UPDATE OF reservation
  ),
  settled AS (
    UPDATE app.ai_budget_reservation AS reservation
    SET status = 'reconciled', input_tokens = NULL, output_tokens = NULL, actual_microdollars = NULL,
      reconciled_at = now()
    FROM abandoned
    WHERE reservation.id = abandoned.id AND reservation.status = 'reserved'
    RETURNING reservation.budget_day, reservation.reserved_microdollars
  ),
  per_day AS (
    SELECT budget_day, sum(reserved_microdollars) AS released, sum(reserved_microdollars) * $2::integer AS charge
    FROM settled
    GROUP BY budget_day
  )
  UPDATE app.ai_budget_day AS day
  SET reserved_microdollars = day.reserved_microdollars - per_day.released,
    consumed_microdollars = day.consumed_microdollars + least(
      per_day.charge,
      day.budget_microdollars - (day.reserved_microdollars - per_day.released) - day.consumed_microdollars
    ),
    version = day.version + 1
  FROM per_day
  WHERE day.budget_day = per_day.budget_day`;

const RESERVE = `
  UPDATE app.ai_budget_day
  SET reserved_microdollars = reserved_microdollars + $2::bigint, version = version + 1
  WHERE budget_day = $1::date
    AND reserved_microdollars + consumed_microdollars + $2::bigint <= budget_microdollars
  RETURNING 1 AS reserved`;

const INSERT_RESERVATION = `
  INSERT INTO app.ai_budget_reservation (ai_job_id, budget_day, reserved_microdollars, status, created_at)
  VALUES ($1, $2::date, $3::bigint, 'reserved', now())`;

const LOCK_DAY_OF_RESERVATION = `
  SELECT 1 FROM app.ai_budget_day
  WHERE budget_day = (SELECT budget_day FROM app.ai_budget_reservation WHERE ai_job_id = $1)
  FOR UPDATE`;

const SETTLE = `
  WITH settled AS (
    UPDATE app.ai_budget_reservation
    SET status = $2, input_tokens = $3::integer, output_tokens = $4::integer, actual_microdollars = $5::bigint,
      reconciled_at = now()
    WHERE ai_job_id = $1 AND status = 'reserved'
    RETURNING budget_day, reserved_microdollars
  )
  UPDATE app.ai_budget_day AS day
  SET reserved_microdollars = day.reserved_microdollars - settled.reserved_microdollars,
    consumed_microdollars = day.consumed_microdollars + least(
      $6::bigint,
      day.budget_microdollars - (day.reserved_microdollars - settled.reserved_microdollars) - day.consumed_microdollars
    ),
    version = day.version + 1
  FROM settled
  WHERE day.budget_day = settled.budget_day`;

export function createAiBudgetRepository(deps: { sql: Sql }): AiBudgetRepository {
  const { sql } = deps;
  return {
    async ensureToday(tx, configuredMicrodollars) {
      const row = (
        await sql.query<{ budget_day: string; seconds_to_next_day: number }>(tx, ENSURE_TODAY, [configuredMicrodollars])
      )[0];
      if (row === undefined) {
        throw new Error("budget day statement returned no row");
      }
      return { budgetDay: row.budget_day, secondsToNextDay: row.seconds_to_next_day };
    },
    async lockDaysForExpiry(tx, today) {
      const row = (await sql.query<{ cutoff: Date }>(tx, LOCK_DAYS_FOR_EXPIRY, [today]))[0];
      if (row === undefined) {
        throw new Error("today's budget day is missing");
      }
      return row.cutoff;
    },
    async applyConfiguredBudget(tx, today, configuredMicrodollars) {
      await sql.query(tx, APPLY_CONFIGURED_BUDGET, [today, configuredMicrodollars]);
    },
    async settleAbandoned(tx, cutoff, maxAttempts) {
      await sql.query(tx, SETTLE_ABANDONED, [cutoff, maxAttempts]);
    },
    async reserve(tx, today, amount) {
      return (await sql.query(tx, RESERVE, [today, amount])).length === 1;
    },
    async insertReservation(tx, jobId, budgetDay, amount) {
      await sql.query(tx, INSERT_RESERVATION, [jobId, budgetDay, amount]);
    },
    async settle(tx, jobId, settlement) {
      await sql.query(tx, LOCK_DAY_OF_RESERVATION, [jobId]);
      const usage =
        settlement.status === "reconciled"
          ? [settlement.inputTokens, settlement.outputTokens, settlement.actualMicrodollars]
          : [null, null, 0];
      await sql.query(tx, SETTLE, [jobId, settlement.status, ...usage, settlement.chargeMicrodollars]);
    },
  };
}
