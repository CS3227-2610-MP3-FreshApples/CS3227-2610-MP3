import "server-only";

import type { Database, Sql } from "../../../db";
import { createSchedulerLeaseRepository } from "../../../repositories/ai";
import type { Result } from "../../../shared";
import type { SchedulerLeases } from "./types";

/** Sweep leases outlive the 120-second maxDuration (data-model.md SchedulerLease, O-29). */
const SWEEP_LEASE_MS = 150_000;

/**
 * K10 sweep leases (contracts §13; D-66, O-29, O-30): the same guarded acquire and release as `ai_execution`.
 * Acquiring and releasing each run in their own short Tx, so `withSweepLease` must be called with no Tx open,
 * and `work` runs with none held.
 */
export function createSchedulerLeases(deps: { database: Database; sql: Sql }): SchedulerLeases {
  const { database } = deps;
  const leases = createSchedulerLeaseRepository({ sql: deps.sql });

  return {
    async withSweepLease(name, work) {
      const acquired = await database.withTransactionResult<string, "held">(async (tx): Promise<Result<string, "held">> => {
        if ((await leases.lock(tx, name)).held) {
          return { ok: false, error: "held" };
        }
        return { ok: true, value: (await leases.take(tx, name, SWEEP_LEASE_MS)).leaseToken };
      });
      if (!acquired.ok) {
        return { acquired: false };
      }
      try {
        return { acquired: true, value: await work() };
      } finally {
        try {
          await database.withTransaction((tx) => leases.release(tx, name, acquired.value));
        } catch {
          // The lease expires on its own (D-66); a failed release must not replace the work's result.
        }
      }
    },
  };
}
