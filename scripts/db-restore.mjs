import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { decryptBackup, HEADER_BYTES, verificationSink } from "./lib/backup-envelope.mjs";
import { assertDisposableDatabaseEmpty, externalAbsolutePath, parseOperatorTarget, parsePassphrase, pgClientConfig, requiredEnv, RESTORE_CONFIRMATION, withLibpqEnvironment } from "./lib/backup-common.mjs";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 && signal === null ? resolve() : reject(new Error("database restore failed")));
  });
}

async function readHeader(handle) {
  const header = Buffer.alloc(HEADER_BYTES);
  const { bytesRead } = await handle.read(header, 0, HEADER_BYTES, 0);
  if (bytesRead !== HEADER_BYTES) throw new Error("backup envelope is truncated");
  return header;
}

function encryptedBody(handle) {
  return createReadStream("", { fd: handle.fd, autoClose: false, start: HEADER_BYTES });
}

async function snapshotEncryptedInput(inputPath) {
  const directory = await mkdtemp(path.join(tmpdir(), "freshapples-db-restore-"));
  const snapshotPath = path.join(directory, "backup.enc");
  try {
    const input = await open(inputPath, "r");
    try {
      const output = createWriteStream(snapshotPath, { flags: "wx", mode: 0o600 });
      await pipeline(input.createReadStream({ autoClose: false }), output);
    } finally {
      await input.close();
    }
    return { directory, handle: await open(snapshotPath, "r") };
  } catch (error) {
    // This command owns only its newly created scratch directory, never the operator's input.
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function runRestore({ env = process.env, repositoryRoot = REPOSITORY_ROOT, spawnProcess = spawn, createClient = (config) => new pg.Client(config) } = {}) {
  const target = parseOperatorTarget(env, { restore: true });
  if (env.RESTORE_CONFIRM_EMPTY_DATABASE !== RESTORE_CONFIRMATION) throw new Error("restore confirmation is missing");
  const passphrase = parsePassphrase(env);
  const inputPath = externalAbsolutePath(requiredEnv(env, "BACKUP_INPUT_PATH"), repositoryRoot, "BACKUP_INPUT_PATH");

  const client = createClient(pgClientConfig(target));
  await client.connect();
  try { await assertDisposableDatabaseEmpty(client); } finally { await client.end(); }

  let snapshot;
  try {
    snapshot = await snapshotEncryptedInput(inputPath);
    const header = await readHeader(snapshot.handle);
    await decryptBackup(encryptedBody(snapshot.handle), verificationSink(), passphrase, header);

    await withLibpqEnvironment(target, env, async (childEnv) => {
      const child = spawnProcess("pg_restore", [
        `--dbname=${decodeURIComponent(target.url.pathname.slice(1))}`,
        // The export already contains only app. A restore-time schema filter omits CREATE SCHEMA.
        "--no-owner", "--exit-on-error", "--single-transaction",
      ], { env: childEnv, stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
      const [decryption, restoreProcess] = await Promise.allSettled([
        decryptBackup(encryptedBody(snapshot.handle), child.stdin, passphrase, header),
        waitForChild(child),
      ]);
      if (decryption.status === "rejected" || restoreProcess.status === "rejected") {
        throw new Error("database restore failed");
      }
    });
  } finally {
    if (snapshot) {
      await snapshot.handle.close();
      await rm(snapshot.directory, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runRestore();
    console.log("database_restore=completed");
  } catch {
    console.error("db:restore failed");
    process.exitCode = 1;
  }
}
