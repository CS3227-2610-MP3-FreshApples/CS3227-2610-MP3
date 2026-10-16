import type { TestProject } from "vitest/node";

import { createMigratedDatabase, testServerUrl } from "./test-database.mjs";

declare module "vitest" {
  export interface ProvidedContext {
    /** URL of this run's throwaway, fully migrated database. */
    testDatabaseUrl: string;
  }
}

/**
 * Integration global setup (D-10): creates a uniquely named database on the local server, applies every
 * migration to it, and drops it when the run ends.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await createMigratedDatabase(testServerUrl(), "mp3_test");
  project.provide("testDatabaseUrl", database.url);
  return database.drop;
}
