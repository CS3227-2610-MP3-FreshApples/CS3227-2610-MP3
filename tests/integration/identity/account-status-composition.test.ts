import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { testDatabaseUrl } from "../database/test-database";

const VALID_ENV = {
  APP_ENV: "test",
  PUBLIC_APP_URL: "http://localhost:3000",
  DATABASE_URL: testDatabaseUrl(),
  SESSION_SECRET: "synthetic-session-secret-012345678901234567890123456789",
  RATE_LIMIT_KEY_SECRET: "synthetic-rate-limit-secret-012345678901234567890123456789",
} as const;

async function loadComposition(databaseUrl: string) {
  vi.resetModules();
  Object.assign(process.env, VALID_ENV, { DATABASE_URL: databaseUrl });
  delete process.env.DATABASE_CA_CERT;
  return import("../../../src/server/composition");
}

describe("K4 account-status composition", () => {
  it("is unavailable when core database dependencies are invalid", async () => {
    const composition = await loadComposition("");

    expect(composition.database).toBeNull();
    expect(composition.accountStatusService).toBeNull();
  });

  it("is exposed when Identity account and session repositories are available", async () => {
    const composition = await loadComposition(testDatabaseUrl());

    expect(composition.database).not.toBeNull();
    expect(composition.accountStatusService).not.toBeNull();
    expect(composition.accountStatusService).toMatchObject({
      lockUserAccount: expect.any(Function),
      lockUserAccountAtVersion: expect.any(Function),
      suspend: expect.any(Function),
      reinstate: expect.any(Function),
    });
  });
});
