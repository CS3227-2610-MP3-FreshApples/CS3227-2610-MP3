import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../../../src");
const ADAPTER = join(SRC, "server", "adapters", "soc-llm");
const RUNTIME = join(SRC, "server", "services", "ai", "runtime");
const COMPOSITION = join(SRC, "server", "composition.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function isWithin(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir + sep);
}

// Static `import … from`, `export … from`, side-effect `import "…"` and dynamic `import("…")`.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

/** `specifier` as an absolute path where it is relative or uses the `@/` alias; `null` for a package. */
function resolveSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) {
    return join(SRC, specifier.slice(2));
  }
  return specifier.startsWith(".") ? resolve(dirname(file), specifier) : null;
}

/** Every module specifier in `file` that names a path in `src/`, resolved. */
function resolvedImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(SPECIFIER)].flatMap(([, specifier]) => resolveSpecifier(file, specifier!) ?? []);
}

const outsideAdapter = sourceFiles(SRC).filter((path) => !isWithin(path, ADAPTER));

describe("soc-llm adapter import boundary (D-71, AM-18)", () => {
  it("is imported only by services/ai/runtime/ and the composition root", () => {
    const importers = outsideAdapter
      .filter((path) => resolvedImports(path).some((target) => isWithin(target, ADAPTER)))
      .filter((path) => !isWithin(path, RUNTIME) && path !== COMPOSITION)
      .map((path) => relative(SRC, path));

    expect(importers).toEqual([]);
  });

  it("is reached by the composition root only through its index, if at all", () => {
    const deepImports = resolvedImports(COMPOSITION).filter(
      (target) => isWithin(target, ADAPTER) && target !== ADAPTER && target !== join(ADAPTER, "index"),
    );

    expect(deepImports).toEqual([]);
  });

  it("recognises relative and @/ imports of the adapter (resolver self-check)", () => {
    const file = join(RUNTIME, "example.ts");
    const hits = (specifier: string) => isWithin(resolveSpecifier(file, specifier) ?? "", ADAPTER);

    expect(hits("../../../adapters/soc-llm")).toBe(true);
    expect(hits("@/server/adapters/soc-llm/fake-llm-provider")).toBe(true);
    expect(hits("../../../adapters/soc-llm-other")).toBe(false);
    expect(hits("soc-llm")).toBe(false);
    const sample = ['import { x } from "./a";', "export * from './b';", 'import "./c";', 'await import("./d");'].join("\n");
    expect([...sample.matchAll(SPECIFIER)].map((match) => match[1])).toEqual(["./a", "./b", "./c", "./d"]);
  });
});

describe("scripted LLM fake boundary (D-53, D-57, D-71)", () => {
  it("is named in no src/ file outside the soc-llm adapter", () => {
    const naming = outsideAdapter
      .filter((path) => /fake-llm-provider/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

    expect(naming).toEqual([]);
  });

  it("is never built by the composition root", () => {
    const composition = readFileSync(COMPOSITION, "utf8");

    expect(composition).not.toMatch(/fake-llm-provider|(?<!Marker)FakeLlmProvider\b|\bcreateFakeLlmProvider\b/);
  });

  it("is not exported from the adapter index", () => {
    const index = readFileSync(join(ADAPTER, "index.ts"), "utf8");

    expect(index).not.toMatch(/fake-llm-provider|createFakeLlmProvider/);
  });

  it("does not match the marker fake's file name (D-78)", () => {
    const adapterFiles = readdirSync(ADAPTER);

    expect(adapterFiles).toContain("fake-llm-provider.ts");
    expect(adapterFiles.filter((name) => /fake-llm-provider/.test(name))).toEqual(["fake-llm-provider.ts"]);
  });
});
