// Controlled release operation: a completed encrypted export must precede migrations.
import { fileURLToPath } from "node:url";
import path from "node:path";

import { migrateUp } from "../src/server/db/migrate.mjs";
import { runBackup } from "./db-backup.mjs";
import { parseOperatorTarget } from "./lib/backup-common.mjs";

export async function runRelease({ env = process.env, backup = runBackup, migrate = migrateUp,
  writeOutput = (line) => console.log(line), writeError = (line) => console.error(line) } = {}) {
  try {
    const target = parseOperatorTarget(env);
    const backedUp = await backup({ env, writeOutput, writeError });
    if (backedUp !== 0) return 1;
    // Do not forward raw migration messages/errors, which may contain SQL or driver data.
    await migrate({ url: target.url.href, caCert: target.caCert }, () => undefined);
    writeOutput("database_migration=completed");
    return 0;
  } catch {
    writeError("db:release failed");
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runRelease();
}
