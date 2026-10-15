import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/setup/integration-database.ts"],
          setupFiles: ["tests/setup/truncate-app-tables.ts"],
          // Files share one database and truncate it on start, so they must not overlap (D-10).
          fileParallelism: false,
        },
      },
    ],
  },
});
