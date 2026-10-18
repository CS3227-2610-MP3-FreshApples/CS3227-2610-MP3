import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../../../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("scripted LLM fake boundary (D-57, AM-18)", () => {
  it("is imported by no src/ module outside the soc-llm adapter", () => {
    const adapterDir = join("server", "adapters", "soc-llm") + sep;
    const importers = sourceFiles(SRC)
      .filter((path) => !relative(SRC, path).startsWith(adapterDir))
      .filter((path) => /fake-llm-provider/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

    expect(importers).toEqual([]);
  });

  it("is not imported by the composition root, which constructs no LLM provider before S-06 (D-52)", () => {
    const composition = readFileSync(join(SRC, "server", "composition.ts"), "utf8");

    expect(composition).not.toMatch(/fake-llm-provider|createFakeLlmProvider|adapters\/soc-llm/);
  });

  it("is not exported from the adapter index", () => {
    const index = readFileSync(join(SRC, "server", "adapters", "soc-llm", "index.ts"), "utf8");

    expect(index).not.toMatch(/from\s+"\.\/fake-llm-provider"/);
  });
});
