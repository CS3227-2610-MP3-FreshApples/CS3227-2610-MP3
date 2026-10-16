// Local secret scan (D-41 "Local use"): runs the pinned gitleaks CLI over the commits on this branch that are
// not on origin/master, then over .next/static. It does not build, and the canary check runs only in CI.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PINNED_VERSION = "8.30.1";
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = path.join(repoRoot, ".gitleaks.toml");

function gitleaks(args) {
  return spawnSync("gitleaks", args, { cwd: repoRoot, stdio: "inherit" }).status;
}

function main() {
  const version = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  if (version.error !== undefined) {
    console.error(`check:secrets: gitleaks is not on PATH; install gitleaks v${PINNED_VERSION} (D-41)`);
    return 1;
  }
  if (!version.stdout.includes(PINNED_VERSION)) {
    console.warn(`check:secrets: warning: CI pins gitleaks v${PINNED_VERSION}; this is ${version.stdout.trim()}`);
  }
  if (!existsSync(path.join(repoRoot, ".next", "static"))) {
    console.error("check:secrets: .next/static is missing; run `npm run build` first");
    return 1;
  }

  const common = ["--config", config, "--redact", "--no-banner"];
  const historyStatus = gitleaks(["git", ...common, "--log-opts=origin/master..HEAD", repoRoot]);
  const staticStatus = gitleaks(["dir", ...common, path.join(repoRoot, ".next", "static")]);
  return historyStatus === 0 && staticStatus === 0 ? 0 : 1;
}

process.exitCode = main();
