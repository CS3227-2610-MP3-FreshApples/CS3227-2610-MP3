// Dependency-audit gate (D-40): runs `npm audit --json` over all dependencies and fails on any high or
// critical advisory that is not an approved exception. Approved exceptions are recorded in spec/governance.md
// §14 and mirrored in audit-exceptions.json; an expired or stale entry also fails. No dependencies.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FAILING_SEVERITIES = new Set(["high", "critical"]);
const GHSA_ID = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/;
const EXACT_GHSA_ID = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXCEPTION_KEYS = ["id", "reviewBy"];

function isRealIsoDate(value) {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validates the parsed contents of audit-exceptions.json: an array of `{ "id": "GHSA-…", "reviewBy":
 * "YYYY-MM-DD" }` with no other keys and no duplicate IDs.
 */
export function parseExceptions(value) {
  if (!Array.isArray(value)) {
    return { exceptions: [], problems: ["audit-exceptions.json must be a JSON array"] };
  }
  const exceptions = [];
  const problems = [];
  const seen = new Set();
  value.forEach((entry, index) => {
    const where = `audit-exceptions.json entry ${index}`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${where} must be an object`);
      return;
    }
    const keys = Object.keys(entry).sort();
    if (keys.length !== EXCEPTION_KEYS.length || keys.some((key, i) => key !== EXCEPTION_KEYS[i])) {
      problems.push(`${where} must have exactly the keys "id" and "reviewBy"`);
      return;
    }
    const { id, reviewBy } = entry;
    if (typeof id !== "string" || !EXACT_GHSA_ID.test(id)) {
      problems.push(`${where} has an id that is not a GHSA advisory ID`);
      return;
    }
    if (typeof reviewBy !== "string" || !isRealIsoDate(reviewBy)) {
      problems.push(`${where} (${id}) has a reviewBy that is not a YYYY-MM-DD date`);
      return;
    }
    if (seen.has(id)) {
      problems.push(`${where} duplicates ${id}`);
      return;
    }
    seen.add(id);
    exceptions.push({ id, reviewBy });
  });
  return { exceptions, problems };
}

/**
 * Collects the advisories in an `npm audit --json` (report version 2) report. Only advisory objects in a
 * package's `via` list are advisories; string entries name the vulnerable dependency they come through.
 */
export function collectAdvisories(report) {
  const advisories = [];
  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities)) {
    for (const via of vulnerability?.via ?? []) {
      if (via === null || typeof via !== "object") {
        continue;
      }
      const match = typeof via.url === "string" ? via.url.match(GHSA_ID) : null;
      advisories.push({
        id: match === null ? null : match[0],
        severity: via.severity,
        packageName,
        title: typeof via.title === "string" ? via.title : "untitled advisory",
      });
    }
  }
  return advisories;
}

/**
 * Returns every reason the audit fails; an empty list passes. `today` is the current UTC date as
 * `YYYY-MM-DD`.
 */
export function checkAudit(report, exceptionsValue, today) {
  if (report === null || typeof report !== "object" || report.error !== undefined) {
    return ["npm audit reported an error instead of an audit report"];
  }
  if (report.auditReportVersion !== 2 || report.vulnerabilities === null || typeof report.vulnerabilities !== "object") {
    return ["npm audit output is not an audit report (version 2)"];
  }

  const { exceptions, problems } = parseExceptions(exceptionsValue);
  const violations = [...problems];
  const advisories = collectAdvisories(report);
  const accepted = new Set(exceptions.map((exception) => exception.id));

  const unlisted = new Set();
  for (const advisory of advisories) {
    if (!FAILING_SEVERITIES.has(advisory.severity)) {
      continue;
    }
    if (advisory.id === null) {
      violations.push(`${advisory.severity} advisory without a GHSA ID in ${advisory.packageName}: ${advisory.title}`);
    } else if (!accepted.has(advisory.id) && !unlisted.has(advisory.id)) {
      unlisted.add(advisory.id);
      violations.push(`${advisory.severity} advisory ${advisory.id} (${advisory.packageName}) is not an approved exception`);
    }
  }

  const reported = new Set(advisories.map((advisory) => advisory.id).filter((id) => id !== null));
  for (const exception of exceptions) {
    if (exception.reviewBy < today) {
      violations.push(`exception ${exception.id} expired on ${exception.reviewBy}; review it and update §14`);
    }
    if (!reported.has(exception.id)) {
      violations.push(`exception ${exception.id} matches no reported advisory; remove it and update §14`);
    }
  }
  return violations;
}

function runNpmAudit() {
  // A constant command line through the shell, so npm resolves on Windows (npm.cmd) as well as Linux.
  const result = spawnSync("npm audit --json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true });
  if (result.error !== undefined) {
    throw new Error("could not run npm audit");
  }
  // npm audit exits nonzero whenever it finds any advisory, so the exit code is not the verdict.
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("npm audit did not print JSON");
  }
}

function main() {
  const exceptionsValue = JSON.parse(readFileSync(new URL("../audit-exceptions.json", import.meta.url), "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const violations = checkAudit(runNpmAudit(), exceptionsValue, today);
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`dependency-audit: ${violation}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("dependency-audit: no unapproved high or critical advisories");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`dependency-audit failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
