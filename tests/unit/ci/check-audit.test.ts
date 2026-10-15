import { describe, expect, it } from "vitest";

import { checkAudit, parseExceptions } from "../../../scripts/check-audit.mjs";

// Synthetic npm audit reports (version 2). The advisory IDs are made up and match no real advisory.
const ACCEPTED_ID = "GHSA-aaaa-bbbb-cccc";
const OTHER_ID = "GHSA-dddd-eeee-ffff";
const TODAY = "2026-10-15";

function advisory(id: string | null, severity: string) {
  return {
    source: 1,
    name: "synthetic-package",
    dependency: "synthetic-package",
    title: "synthetic advisory",
    url: id === null ? "https://example.test/advisory/1" : `https://github.com/advisories/${id}`,
    severity,
    range: "<=1.0.0",
  };
}

function report(vulnerabilities: Record<string, { severity: string; via: unknown[] }>) {
  return { auditReportVersion: 2, vulnerabilities, metadata: {} };
}

const ACCEPTED_REPORT = report({
  "synthetic-package": { severity: "high", via: [advisory(ACCEPTED_ID, "high")] },
  // A dependent package lists the vulnerable package by name; it is not a separate advisory.
  "synthetic-dependent": { severity: "high", via: ["synthetic-package"] },
});

describe("checkAudit — passing reports", () => {
  it("passes a report with no advisories and no exceptions", () => {
    expect(checkAudit(report({}), [], TODAY)).toEqual([]);
  });

  it("passes a high advisory that is an approved, unexpired exception", () => {
    expect(checkAudit(ACCEPTED_REPORT, [{ id: ACCEPTED_ID, reviewBy: "2026-11-15" }], TODAY)).toEqual([]);
  });

  it("still accepts an exception on its reviewBy date", () => {
    expect(checkAudit(ACCEPTED_REPORT, [{ id: ACCEPTED_ID, reviewBy: TODAY }], TODAY)).toEqual([]);
  });

  it("ignores low and moderate advisories", () => {
    const lowAndModerate = report({
      "synthetic-package": { severity: "moderate", via: [advisory(OTHER_ID, "moderate"), advisory(null, "low")] },
    });
    expect(checkAudit(lowAndModerate, [], TODAY)).toEqual([]);
  });
});

describe("checkAudit — failing reports", () => {
  it.each(["high", "critical"])("fails a %s advisory that is not listed", (severity) => {
    const unlisted = report({ "synthetic-package": { severity, via: [advisory(OTHER_ID, severity)] } });
    const violations = checkAudit(unlisted, [], TODAY);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(OTHER_ID);
  });

  it("fails an unlisted advisory alongside a listed one", () => {
    const mixed = report({
      "synthetic-package": { severity: "critical", via: [advisory(ACCEPTED_ID, "high"), advisory(OTHER_ID, "critical")] },
    });
    const violations = checkAudit(mixed, [{ id: ACCEPTED_ID, reviewBy: "2026-11-15" }], TODAY);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(OTHER_ID);
  });

  it("reports an unlisted advisory once even when several packages carry it", () => {
    const repeated = report({
      "synthetic-a": { severity: "high", via: [advisory(OTHER_ID, "high")] },
      "synthetic-b": { severity: "high", via: [advisory(OTHER_ID, "high")] },
    });
    expect(checkAudit(repeated, [], TODAY)).toHaveLength(1);
  });

  it("fails a high advisory without a GHSA ID, since it cannot be an exception", () => {
    const noId = report({ "synthetic-package": { severity: "high", via: [advisory(null, "high")] } });
    const violations = checkAudit(noId, [], TODAY);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("without a GHSA ID");
  });

  it("fails an exception past its reviewBy date", () => {
    const violations = checkAudit(ACCEPTED_REPORT, [{ id: ACCEPTED_ID, reviewBy: "2026-10-14" }], TODAY);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("expired");
  });

  it("fails a stale exception that matches no reported advisory", () => {
    const violations = checkAudit(report({}), [{ id: ACCEPTED_ID, reviewBy: "2026-11-15" }], TODAY);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("matches no reported advisory");
  });

  it("fails an npm error object instead of passing it as an empty report", () => {
    expect(checkAudit({ error: { code: "ENOTFOUND", summary: "synthetic" } }, [], TODAY)).toHaveLength(1);
  });

  it.each([
    ["an older report version", { auditReportVersion: 1, advisories: {} }],
    ["a report without vulnerabilities", { auditReportVersion: 2 }],
    ["null", null],
  ])("fails %s", (_label, value) => {
    expect(checkAudit(value, [], TODAY)).toHaveLength(1);
  });

  it("fails when the exceptions file is malformed", () => {
    expect(checkAudit(report({}), { id: ACCEPTED_ID }, TODAY)).toEqual(["audit-exceptions.json must be a JSON array"]);
  });
});

describe("parseExceptions", () => {
  it("accepts well-formed entries", () => {
    expect(parseExceptions([{ id: ACCEPTED_ID, reviewBy: "2026-11-15" }])).toEqual({
      exceptions: [{ id: ACCEPTED_ID, reviewBy: "2026-11-15" }],
      problems: [],
    });
  });

  it.each([
    ["a non-object entry", ["GHSA-aaaa-bbbb-cccc"]],
    ["a missing reviewBy", [{ id: ACCEPTED_ID }]],
    ["an extra key", [{ id: ACCEPTED_ID, reviewBy: "2026-11-15", justification: "synthetic" }]],
    ["a non-GHSA id", [{ id: "CVE-2026-0001", reviewBy: "2026-11-15" }]],
    ["an id with surrounding text", [{ id: ` ${ACCEPTED_ID}`, reviewBy: "2026-11-15" }]],
    ["a non-ISO date", [{ id: ACCEPTED_ID, reviewBy: "15/11/2026" }]],
    ["an impossible date", [{ id: ACCEPTED_ID, reviewBy: "2026-02-30" }]],
    [
      "a duplicate id",
      [
        { id: ACCEPTED_ID, reviewBy: "2026-11-15" },
        { id: ACCEPTED_ID, reviewBy: "2026-11-16" },
      ],
    ],
  ])("rejects %s", (_label, value) => {
    expect(parseExceptions(value).problems).toHaveLength(1);
  });
});
