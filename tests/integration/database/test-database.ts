import { inject } from "vitest";

/**
 * This run's throwaway, migrated database, created on the loopback-only `TEST_DATABASE_URL` server by
 * `tests/setup/integration-database.ts` (D-10).
 */
export function testDatabaseUrl(): string {
  return inject("testDatabaseUrl");
}
