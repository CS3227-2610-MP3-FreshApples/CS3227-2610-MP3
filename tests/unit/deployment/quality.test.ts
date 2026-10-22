import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runBackup } from "../../../scripts/db-backup.mjs";
import { runRestore } from "../../../scripts/db-restore.mjs";
import { parseOperatorTarget, withLibpqEnvironment } from "../../../scripts/lib/backup-common.mjs";

const ENV = {
  NODE_ENV: "test" as const,
  APP_ENV: "test",
  MIGRATION_DATABASE_URL: "postgresql://operator:synthetic-password@127.0.0.1/disposable",
  BACKUP_ENCRYPTION_PASSPHRASE: "synthetic-passphrase-with-at-least-32-characters",
};

describe("DEP-03/DEP-08 fail-closed operator boundaries", () => {
  it.each(["?host=remote.example.test", "?sslmode=disable", "?options=-c%20role%3Dpostgres"])(
    "rejects connection query overrides before invoking a child: %s",
    (query) => {
      expect(() => parseOperatorTarget({ ...ENV, MIGRATION_DATABASE_URL: ENV.MIGRATION_DATABASE_URL + query }))
        .toThrow("query parameters");
    },
  );

  it("removes the temporary CA after an operator subprocess failure", async () => {
    const target = parseOperatorTarget({
      APP_ENV: "production",
      MIGRATION_DATABASE_URL: "postgresql://operator:synthetic-password@db.example.test/app",
      DATABASE_CA_CERT: "synthetic CA fixture",
    });
    let caPath: string | undefined;
    await expect(withLibpqEnvironment(target, { PGSSLMODE: "disable", PGHOSTADDR: "192.0.2.1" }, async (childEnv: NodeJS.ProcessEnv) => {
      caPath = childEnv.PGSSLROOTCERT;
      expect(childEnv.PGSSLMODE).toBe("verify-full");
      expect(childEnv.PGHOST).toBe("db.example.test");
      expect(childEnv.PGHOSTADDR).toBeUndefined();
      expect(readFileSync(caPath!, "utf8")).toBe("synthetic CA fixture");
      throw new Error("synthetic subprocess failure");
    })).rejects.toThrow("synthetic subprocess failure");
    expect(caPath).toBeDefined();
    expect(existsSync(path.dirname(caPath!))).toBe(false);
  });

  it("requires restore confirmation before connecting or starting pg_restore", async () => {
    const createClient = vi.fn();
    const spawnProcess = vi.fn();
    await expect(runRestore({ env: ENV, createClient, spawnProcess })).rejects.toThrow("confirmation");
    expect(createClient).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("rejects a short encryption passphrase before exporting any database bytes", async () => {
    const spawnProcess = vi.fn();
    const writeOutput = vi.fn();
    const writeError = vi.fn();
    expect(await runBackup({
      env: { ...ENV, BACKUP_ENCRYPTION_PASSPHRASE: "short" },
      spawnProcess, writeOutput, writeError,
    })).toBe(1);
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
    expect(writeError.mock.calls).toEqual([["db:backup failed"]]);
  });
});
