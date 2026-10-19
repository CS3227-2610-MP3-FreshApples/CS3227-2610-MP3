import { randomBytes, randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import { createSchedulerLeaseRepository } from "../../../src/server/repositories/ai";
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
/** A second pool: another server instance competing for the same lease rows. */
let other: Database & Sql;
let otherLeases: SchedulerLeases;

beforeAll(async () => {
  owner = await connectAsOwner();
  await createLoginRole(owner, RUNTIME_ROLE, RUNTIME_PASSWORD);
  const url = new URL(testDatabaseUrl());
  url.username = RUNTIME_ROLE;
  url.password = RUNTIME_PASSWORD;
  database = createDatabase({ url: url.href, caCert: null });
  leases = createSchedulerLeases({ database, sql: database });
  other = createDatabase({ url: url.href, caCert: null });
  otherLeases = createSchedulerLeases({ database: other, sql: other });
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

/** A promise the test resolves by hand, so a sweep's work can be held open while another instance competes. */
function gate(): { readonly wait: Promise<void>; readonly open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

/** Moves a lease's end into the past, as if its holder had run past the 150 s lease. */
async function expire(name: string): Promise<void> {
  await owner.query("UPDATE app.scheduler_lease SET lease_until = clock_timestamp() - interval '1 second' WHERE name = $1", [
    name,
  ]);
}

describe("SchedulerLeases.withSweepLease across two instances (D-66, O-29, O-30)", () => {
  it("lets exactly one of two simultaneous acquisitions run the work", async () => {
    const hold = gate();
    const runs: string[] = [];
    const sweep = (label: string, instance: SchedulerLeases) =>
      instance.withSweepLease("summary_sweep", async () => {
        runs.push(label);
        await hold.wait;
        return label;
      });

    const pending = Promise.all([sweep("first", leases), sweep("second", otherLeases)]);
    // The loser is decided in the acquire Tx and resolves without waiting for the winner's work.
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    hold.open();
    const results = await pending;

    expect(results.filter((result) => result.acquired)).toEqual([{ acquired: true, value: runs[0] }]);
    expect(results.filter((result) => !result.acquired)).toEqual([{ acquired: false }]);
    expect(runs).toHaveLength(1);
    expect(await stored("summary_sweep")).toMatchObject({ held: false });
  });

  it("refuses the second instance while the first runs, and admits it after the release", async () => {
    const hold = gate();
    const work = vi.fn(async () => "second");
    const running = leases.withSweepLease("review_moderation_sweep", () => hold.wait.then(() => "first"));
    await vi.waitFor(async () => expect(await stored("review_moderation_sweep")).toMatchObject({ held: true }));

    await expect(otherLeases.withSweepLease("review_moderation_sweep", work)).resolves.toEqual({ acquired: false });
    expect(work).not.toHaveBeenCalled();

    hold.open();
    await expect(running).resolves.toEqual({ acquired: true, value: "first" });
    await expect(otherLeases.withSweepLease("review_moderation_sweep", work)).resolves.toEqual({
      acquired: true,
      value: "second",
    });
  });

  it("keeps the leases independent: holding one sweep does not block the other", async () => {
    const hold = gate();
    const running = leases.withSweepLease("summary_sweep", () => hold.wait);
    await vi.waitFor(async () => expect(await stored("summary_sweep")).toMatchObject({ held: true }));

    await expect(otherLeases.withSweepLease("review_moderation_sweep", async () => "ran")).resolves.toEqual({
      acquired: true,
      value: "ran",
    });

    hold.open();
    await running;
  });

  it("lets a second instance take over an expired lease; the first's late release by its stale token is a no-op", async () => {
    const firstHold = gate();
    const secondHold = gate();
    let firstToken = "";
    let secondToken = "";
    const firstRun = leases.withSweepLease("summary_sweep", async () => {
      firstToken = (await stored("summary_sweep"))!.token;
      await firstHold.wait;
      return "late";
    });
    await vi.waitFor(() => expect(firstToken).not.toBe(""));

    await expire("summary_sweep");
    const secondRun = otherLeases.withSweepLease("summary_sweep", async () => {
      secondToken = (await stored("summary_sweep"))!.token;
      await secondHold.wait;
      return "takeover";
    });
    await vi.waitFor(() => expect(secondToken).not.toBe(""));
    expect(secondToken).not.toBe(firstToken);

    // The first instance finishes late: its work still returns, but its release must not end the new holder's lease.
    firstHold.open();
    await expect(firstRun).resolves.toEqual({ acquired: true, value: "late" });
    const afterStaleRelease = await stored("summary_sweep");
    expect(afterStaleRelease).toMatchObject({ held: true, token: secondToken });
    expect(afterStaleRelease!.seconds).toBeGreaterThan(140);

    secondHold.open();
    await expect(secondRun).resolves.toEqual({ acquired: true, value: "takeover" });
    expect(await stored("summary_sweep")).toMatchObject({ held: false, token: secondToken });
  });

  it("ignores a release from another instance whose token does not match", async () => {
    const hold = gate();
    const running = leases.withSweepLease("summary_sweep", () => hold.wait);
    await vi.waitFor(async () => expect(await stored("summary_sweep")).toMatchObject({ held: true }));
    const before = (await stored("summary_sweep"))!;

    await other.withTransaction((tx) => createSchedulerLeaseRepository({ sql: other }).release(tx, "summary_sweep", randomUUID()));

    expect(await stored("summary_sweep")).toMatchObject({ held: true, token: before.token });
    hold.open();
    await running;
  });
});
