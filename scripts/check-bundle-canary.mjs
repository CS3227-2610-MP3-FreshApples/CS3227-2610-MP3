// Built-asset canary check (D-29, D-41): after the CI canary build, fails if any server-only secret's canary
// value appears in any file under .next/static. Prints variable names and file paths, never values.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Every server-only secret in deployment.md 10.3; a PR adding one adds it here (D-41). */
export const CANARY_VARIABLES = [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "SESSION_SECRET",
  "RATE_LIMIT_KEY_SECRET",
  "CRON_SECRET",
  "SOC_LLM_API_KEY",
];
/** Connection strings carry their canary in the password (D-41). */
const URL_VARIABLES = new Set(["DATABASE_URL", "MIGRATION_DATABASE_URL"]);
/** Short values would match by coincidence, so a canary must be distinctive. */
const MIN_CANARY_LENGTH = 16;

function canaryOf(variable, raw) {
  if (!URL_VARIABLES.has(variable)) {
    return raw;
  }
  try {
    return decodeURIComponent(new URL(raw).password);
  } catch {
    return "";
  }
}

/** Reads the canary value of every variable in `CANARY_VARIABLES` from `env`. */
export function canaryValues(env) {
  const canaries = [];
  const problems = [];
  const seen = new Set();
  for (const variable of CANARY_VARIABLES) {
    const raw = env[variable];
    const value = raw === undefined ? "" : canaryOf(variable, raw);
    if (value.length < MIN_CANARY_LENGTH) {
      problems.push(`${variable} must carry a canary of at least ${MIN_CANARY_LENGTH} characters`);
    } else if (seen.has(value)) {
      problems.push(`${variable} reuses another variable's canary`);
    } else {
      seen.add(value);
      canaries.push({ variable, value });
    }
  }
  return { canaries, problems };
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : entry.isFile() ? [entryPath] : [];
  });
}

/** Returns one finding per canary per file under `directory` that contains it, compared as raw bytes. */
export function findCanaries(directory, canaries) {
  const findings = [];
  for (const file of listFiles(directory)) {
    const contents = readFileSync(file);
    for (const { variable, value } of canaries) {
      if (contents.includes(value)) {
        findings.push({ variable, file: path.relative(directory, file) });
      }
    }
  }
  return findings;
}

function main() {
  const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".next", "static");
  if (!existsSync(staticDir) || !statSync(staticDir).isDirectory()) {
    throw new Error(".next/static is missing; run the canary build first");
  }
  const { canaries, problems } = canaryValues(process.env);
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`bundle-canary: ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  const findings = findCanaries(staticDir, canaries);
  if (findings.length > 0) {
    for (const { variable, file } of findings) {
      console.error(`bundle-canary: ${variable} appears in .next/static/${file.split(path.sep).join("/")}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`bundle-canary: none of ${canaries.length} canaries appear in .next/static`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`bundle-canary failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
