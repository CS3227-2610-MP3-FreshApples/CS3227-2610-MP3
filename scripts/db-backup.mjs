import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { link, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { encryptBackup } from "./lib/backup-envelope.mjs";
import { externalAbsolutePath, parseOperatorTarget, parsePassphrase, requiredEnv, withLibpqEnvironment } from "./lib/backup-common.mjs";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 && signal === null ? resolve() : reject(new Error("database export failed")));
  });
}

async function performBackup({ env, repositoryRoot, spawnProcess }) {
  const target = parseOperatorTarget(env);
  const passphrase = parsePassphrase(env);
  const outputPath = externalAbsolutePath(requiredEnv(env, "BACKUP_OUTPUT_PATH"), repositoryRoot, "BACKUP_OUTPUT_PATH");
  const partialPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.partial-${randomBytes(8).toString("hex")}`);
  await withLibpqEnvironment(target, env, async (childEnv) => {
    const child = spawnProcess("pg_dump", ["--format=custom", "--schema=app", "--no-owner"], {
      env: childEnv, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    });
    const output = createWriteStream(partialPath, { flags: "wx", mode: 0o600 });
    const [encryption, exportProcess] = await Promise.allSettled([
      encryptBackup(child.stdout, output, passphrase),
      waitForChild(child),
    ]);
    if (encryption.status === "rejected" || exportProcess.status === "rejected") {
      throw new Error("database export failed");
    }
  });
  await link(partialPath, outputPath);
  await unlink(partialPath);
  return outputPath;
}

export async function runBackup({
  env = process.env,
  repositoryRoot = REPOSITORY_ROOT,
  spawnProcess = spawn,
  writeOutput = (line) => console.log(line),
  writeError = (line) => console.error(line),
} = {}) {
  try {
    const outputPath = await performBackup({ env, repositoryRoot, spawnProcess });
    writeOutput(`encrypted_backup=${outputPath}`);
    return 0;
  } catch {
    writeError("db:backup failed");
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runBackup();
}
