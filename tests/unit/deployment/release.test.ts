import { describe, expect, it, vi } from "vitest";

import { runRelease } from "../../../scripts/db-release.mjs";

const env = { NODE_ENV: "test" as const, APP_ENV: "test", MIGRATION_DATABASE_URL: "postgresql://operator@127.0.0.1:5432/synthetic" };

describe("DEP-03 guarded migration", () => {
  it("awaits a successful backup before migrating the same target", async () => {
    const events: string[] = [];
    const backup = vi.fn(async () => { events.push("backup"); return 0 as const; });
    const migrate = vi.fn(async (target: { url: string; caCert: string | null }) => {
      expect(target.url).toBe(env.MIGRATION_DATABASE_URL);
      events.push("migrate");
    });
    expect(await runRelease({ env, backup, migrate, writeOutput: vi.fn(), writeError: vi.fn() })).toBe(0);
    expect(events).toEqual(["backup", "migrate"]);
    expect(migrate.mock.calls[0]?.[0]).toEqual({ url: env.MIGRATION_DATABASE_URL, caCert: null });
  });

  it("does not migrate after backup failure", async () => {
    const migrate = vi.fn();
    expect(await runRelease({ env, backup: async () => 1, migrate, writeOutput: vi.fn(), writeError: vi.fn() })).toBe(1);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("does not start a backup for invalid hosted TLS configuration", async () => {
    const backup = vi.fn();
    expect(await runRelease({ env: { ...env, APP_ENV: "production" }, backup, writeError: vi.fn() })).toBe(1);
    expect(backup).not.toHaveBeenCalled();
  });

  it("redacts migration failures", async () => {
    const writeError = vi.fn();
    expect(await runRelease({ env, backup: async () => 0, migrate: async () => { throw new Error("sensitive driver detail"); },
      writeOutput: vi.fn(), writeError })).toBe(1);
    expect(writeError.mock.calls).toEqual([["db:release failed"]]);
  });
});
