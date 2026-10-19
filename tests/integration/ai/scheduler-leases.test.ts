import { randomBytes } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import { createSchedulerLeases, type SchedulerLeases } from "../../../src/server/services/ai/runtime";
import { createLoginRole, dropLoginRole } from "../../setup/test-database.mjs";
import { connectAsOwner } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";

// Runs with app_runtime's privileges (D-31, D-32) through a per-file login role. Generated per run; never recorded.
const RUNTIME_ROLE = `mp3_sweep_lease_${randomBytes(4).toString("hex")}`;
const RUNTIME_PASSWORD = randomBytes(24).toString("hex");

let owner: Client;
let database: Database & Sql;
let leases: SchedulerLeases;

beforeAll(async () => {
  owner = await connectAsOwner();
  await createLoginRole(owner, RUNTIME_ROLE, RUNTIME_PASSWORD);
  const url = new URL(testDatabaseUrl());
  url.username = RUNTIME_ROLE;
  url.password = RUNTIME_PASSWORD;
  database = createDatabase({ url: url.href, caCert: null });
  leases = createSchedulerLeases({ database, sql: database });
});

afterAll(async () => {
  await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1", [RUNTIME_ROLE]);
  await dropLoginRole(owner, RUNTIME_ROLE);
  await owner.end();
});

beforeEach(async () => {
  await owner.query("TRUNCATE app.scheduler_lease");
});

async function stored(name: string): Promise<{ held: boolean; seconds: number; token: string } | null> {
  const { rows } = await owner.query<{ held: boolean; seconds: number; token: string }>(
    `SELECT lease_until > clock_timestamp() AS held, extract(epoch FROM lease_until - clock_timestamp())::float AS seconds,
       lease_token::text AS token
     FROM app.scheduler_lease WHERE name = $1`,
    [name],
  );
  return rows[0] ?? null;
}

describe("SchedulerLeases.withSweepLease (D-66, O-29, O-30)", () => {
  it("runs the work under a 150 s lease with no Tx held, then releases it", async () => {
    let during: Awaited<ReturnType<typeof stored>> = null;

    const result = await leases.withSweepLease("summary_sweep", async () => {
      during = await stored("summary_sweep");
      // A Tx of its own succeeds only when the sweep holds none (K1 throws on nesting, P-05).
      return database.withTransaction(async () => "done");
    });

    expect(result).toEqual({ acquired: true, value: "done" });
    expect(during).toMatchObject({ held: true });
    expect(during!.seconds).toBeGreaterThan(148);
    expect(during!.seconds).toBeLessThanOrEqual(150);
    expect(await stored("summary_sweep")).toMatchObject({ held: false });
  });

  it("does not run the work while another holder's lease is unexpired", async () => {
    await owner.query(
      "INSERT INTO app.scheduler_lease (name, lease_token, lease_until) VALUES ('review_moderation_sweep', gen_random_uuid(), now() + interval '1 minute')",
    );
    const work = vi.fn(async () => "never");

    await expect(leases.withSweepLease("review_moderation_sweep", work)).resolves.toEqual({ acquired: false });

    expect(work).not.toHaveBeenCalled();
    expect(await stored("review_moderation_sweep")).toMatchObject({ held: true });
  });

  it("takes over an expired lease with a new token", async () => {
    const { rows } = await owner.query<{ token: string }>(
      `INSERT INTO app.scheduler_lease (name, lease_token, lease_until)
       VALUES ('summary_sweep', gen_random_uuid(), now() - interval '1 second') RETURNING lease_token::text AS token`,
    );
    let token = "";

    await leases.withSweepLease("summary_sweep", async () => {
      token = (await stored("summary_sweep"))!.token;
    });

    expect(token).not.toBe(rows[0]!.token);
  });

  it("releases the lease and rethrows when the work throws", async () => {
    await expect(
      leases.withSweepLease("summary_sweep", async () => {
        throw new Error("sweep failed");
      }),
    ).rejects.toThrow("sweep failed");

    expect(await stored("summary_sweep")).toMatchObject({ held: false });
  });

  it("does not release a lease another holder took over", async () => {
    let otherToken = "";

    await leases.withSweepLease("summary_sweep", async () => {
      const { rows } = await owner.query<{ token: string }>(
        `UPDATE app.scheduler_lease SET lease_token = gen_random_uuid(), lease_until = now() + interval '1 minute'
         WHERE name = 'summary_sweep' RETURNING lease_token::text AS token`,
      );
      otherToken = rows[0]!.token;
    });

    expect(await stored("summary_sweep")).toMatchObject({ held: true, token: otherToken });
  });
});
