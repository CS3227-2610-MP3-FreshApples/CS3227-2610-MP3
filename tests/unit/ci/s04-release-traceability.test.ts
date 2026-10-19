import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const evidencePath = path.join(process.cwd(), "workflow", "handoffs", "s04-release-evidence.md");

describe("S-04 release traceability", () => {
  it("maps every S-04 acceptance row to concrete evidence without closing deferred work", () => {
    const evidence = readFileSync(evidencePath, "utf8");

    for (const row of [
      "S04-AC-01",
      "S04-AC-02",
      "S04-AC-03",
      "S04-AC-04",
      "S04-AC-05",
      "S04-AC-06",
      "S04-AC-07",
      "S04-AC-08",
    ]) {
      expect(evidence).toMatch(new RegExp(`\\| ${row} \\|.*tests/.*\\| (PASS|PARTIAL) \\|`));
    }

    expect(evidence).toContain("AT-01 remains partial until U-03 and R-02 pass");
    expect(evidence).toContain("FR-01 remains partial until the deferred public auth pages pass E2E");
    expect(evidence).toContain("Preview/Production separation | OPERATOR REQUIRED");
    expect(evidence).toContain("Vercel bootstrap invocation and variable removal | OPERATOR REQUIRED");
    expect(evidence).not.toMatch(/Preview\/Production separation \| PASS/);
    expect(evidence).not.toMatch(/Vercel bootstrap invocation and variable removal \| PASS/);
  });
});
