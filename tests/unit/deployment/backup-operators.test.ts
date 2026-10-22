import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runBackup } from "../../../scripts/db-backup.mjs";
import {
  assertDisposableDatabaseEmpty,
  childBaseEnvironment,
  externalAbsolutePath,
  parseOperatorTarget,
  RESTORE_CONFIRMATION,
} from "../../../scripts/lib/backup-common.mjs";
import { decryptBackup, HEADER_BYTES } from "../../../scripts/lib/backup-envelope.mjs";

const temporaryDirectories: string[] = [];
const PASSPHRASE = "synthetic-passphrase-with-more-than-32-characters";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), "backup-unit-"));
  temporaryDirectories.push(directory);
  return directory;
}

function localEnv(outputPath: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    APP_ENV: "test",
    MIGRATION_DATABASE_URL: "postgresql://operator:synthetic-secret@127.0.0.1:5432/disposable",
    BACKUP_ENCRYPTION_PASSPHRASE: PASSPHRASE,
    BACKUP_OUTPUT_PATH: outputPath,
  };
}

function childFor(bytes: Buffer, exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & { stdout: Readable };
  child.stdout = Readable.from(bytes);
  queueMicrotask(() => child.emit("close", exitCode, null));
  return child;
}

async function decryptFile(file: Buffer) {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await decryptBackup(Readable.from(file.subarray(HEADER_BYTES)), output, PASSPHRASE, file.subarray(0, HEADER_BYTES));
  return Buffer.concat(chunks);
}

describe("backup operator safeguards", () => {
  it("requires explicit absolute paths outside the checkout", () => {
    const repository = path.resolve("D:/checkout");
    expect(() => externalAbsolutePath("relative.dump", repository, "BACKUP_OUTPUT_PATH")).toThrow("absolute");
    expect(() => externalAbsolutePath(path.join(repository, "backup.dump"), repository, "BACKUP_OUTPUT_PATH")).toThrow("outside");
    expect(externalAbsolutePath(path.resolve("D:/private/backup.dump"), repository, "BACKUP_OUTPUT_PATH")).toBe(path.resolve("D:/private/backup.dump"));
  });

  it("allows restore targets only on loopback in local/test", () => {
    const base = { APP_ENV: "test", MIGRATION_DATABASE_URL: "postgresql://operator:pw@127.0.0.1:5432/disposable" };
    expect(parseOperatorTarget(base, { restore: true }).url.hostname).toBe("127.0.0.1");
    expect(() => parseOperatorTarget({ ...base, APP_ENV: "production", DATABASE_CA_CERT: "synthetic" }, { restore: true })).toThrow("restricted");
    expect(() => parseOperatorTarget({ ...base, MIGRATION_DATABASE_URL: "postgresql://operator:pw@db.example.test/db", DATABASE_CA_CERT: "synthetic" }, { restore: true })).toThrow("restricted");
  });

  it("does not pass operator URLs, CA text or encryption secrets to child tools", () => {
    const child = childBaseEnvironment({
      PATH: "synthetic-path",
      PGHOSTADDR: "192.0.2.1",
      PGSERVICE: "unexpected-service",
      PGOPTIONS: "-c role=unexpected",
      MIGRATION_DATABASE_URL: "postgresql://secret",
      DATABASE_CA_CERT: "secret-ca",
      BACKUP_ENCRYPTION_PASSPHRASE: PASSPHRASE,
      RESTORE_CONFIRM_EMPTY_DATABASE: RESTORE_CONFIRMATION,
    });
    expect(child).toEqual({ PATH: "synthetic-path" });
  });

  it("rejects a restore database name that libpq would interpret as connection options", () => {
    expect(() => parseOperatorTarget({ APP_ENV: "test",
      MIGRATION_DATABASE_URL: "postgresql://operator@127.0.0.1/host%3Dremote.example.test" }, { restore: true })).toThrow("database name");
  });

  it("exports only app as a custom archive, retains ACLs, and publishes the requested file only after success", async () => {
    const outputPath = path.join(tempDirectory(), "daily.backup.enc");
    const calls: unknown[][] = [];
    const output: string[] = [];
    const archive = Buffer.from("synthetic pg custom archive");
    const exitCode = await runBackup({
      env: localEnv(outputPath),
      repositoryRoot: path.resolve("D:/checkout"),
      spawnProcess: ((...args: unknown[]) => { calls.push(args); return childFor(archive); }) as never,
      writeOutput: (line: string) => output.push(line),
      writeError: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual([`encrypted_backup=${outputPath}`]);
    expect(calls[0]?.[0]).toBe("pg_dump");
    expect(calls[0]?.[1]).toEqual(["--format=custom", "--schema=app", "--no-owner"]);
    expect(calls[0]?.[1]).not.toContain("--no-privileges");
    expect(JSON.stringify(calls[0]?.[1])).not.toContain("synthetic-secret");
    expect(await decryptFile(readFileSync(outputPath))).toEqual(archive);
  });

  it("never overwrites an existing backup and does not publish the requested filename after export failure", async () => {
    const directory = tempDirectory();
    const existing = path.join(directory, "existing.enc");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(existing, "keep");
    expect(await runBackup({ env: localEnv(existing), repositoryRoot: path.resolve("D:/checkout"), spawnProcess: (() => childFor(Buffer.from("archive"))) as never, writeOutput: vi.fn(), writeError: vi.fn() })).toBe(1);
    expect(readFileSync(existing, "utf8")).toBe("keep");

    const failed = path.join(directory, "failed.enc");
    expect(await runBackup({ env: localEnv(failed), repositoryRoot: path.resolve("D:/checkout"), spawnProcess: (() => childFor(Buffer.from("partial"), 1)) as never, writeOutput: vi.fn(), writeError: vi.fn() })).toBe(1);
    expect(existsSync(failed)).toBe(false);
  });
});

describe("restore preflight", () => {
  it("requires every D-31 role and an empty database", async () => {
    const goodClient = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ rolname: "anon" }, { rolname: "app_runtime" }, { rolname: "authenticated" }] }).mockResolvedValueOnce({ rows: [{ object_count: 0 }] }),
    };
    await expect(assertDisposableDatabaseEmpty(goodClient as never)).resolves.toBeUndefined();

    const missingRole = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(assertDisposableDatabaseEmpty(missingRole as never)).rejects.toThrow("roles");

    const nonempty = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ rolname: "anon" }, { rolname: "app_runtime" }, { rolname: "authenticated" }] }).mockResolvedValueOnce({ rows: [{ object_count: 1 }] }),
    };
    await expect(assertDisposableDatabaseEmpty(nonempty as never)).rejects.toThrow("not empty");
  });
});
