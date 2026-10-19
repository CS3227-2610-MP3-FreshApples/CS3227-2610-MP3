import { describe, expect, it, vi } from "vitest";

import { runFirstAdminVerification } from "../../../scripts/verify-first-admin.mjs";

interface FakeClient {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function clientWithCount(count: number): FakeClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockImplementation(async (sql: string) =>
      sql.includes("count(*)") ? { rows: [{ admin_count: count }] } : { rows: [] },
    ),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

const LOCAL_ENV = {
  APP_ENV: "test",
  MIGRATION_DATABASE_URL: "postgresql://operator:synthetic@127.0.0.1:5432/postgres",
};

async function run(client: FakeClient, env: Record<string, string | undefined> = LOCAL_ENV) {
  const output: string[] = [];
  const errors: string[] = [];
  const exitCode = await runFirstAdminVerification({
    env,
    createClient: vi.fn(() => client),
    writeOutput: (line: string) => output.push(line),
    writeError: (line: string) => errors.push(line),
  });
  return { exitCode, output, errors };
}

describe("first-Admin operator verification", () => {
  it.each([
    [0, 1],
    [1, 0],
    [2, 1],
  ])("prints only the count and exits successfully exactly for one Admin (count %i)", async (count, expectedExit) => {
    const result = await run(clientWithCount(count));

    expect(result).toEqual({ exitCode: expectedExit, output: [`admin_count=${count}`], errors: [] });
  });

  it("uses a bounded read-only transaction and closes the connection", async () => {
    const client = clientWithCount(1);

    await run(client);

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = '5s'",
      "SELECT count(*)::int AS admin_count FROM app.account WHERE role = 'ADMIN'",
      "COMMIT",
    ]);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing URL", { APP_ENV: "production", DATABASE_CA_CERT: "synthetic-ca" }],
    ["missing production CA", { APP_ENV: "production", MIGRATION_DATABASE_URL: LOCAL_ENV.MIGRATION_DATABASE_URL }],
    ["URL TLS override", { ...LOCAL_ENV, MIGRATION_DATABASE_URL: `${LOCAL_ENV.MIGRATION_DATABASE_URL}?sslmode=disable` }],
  ])("fails closed without opening a connection for %s", async (_label, env) => {
    const client = clientWithCount(1);
    const result = await run(client, env);

    expect(result).toEqual({ exitCode: 1, output: [], errors: ["db:verify-first-admin failed"] });
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("rolls back and emits no raw error or connection detail when the query fails", async () => {
    const client = clientWithCount(1);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT")) throw new Error(`synthetic failure ${LOCAL_ENV.MIGRATION_DATABASE_URL}`);
      return { rows: [] };
    });

    const result = await run(client);

    expect(result).toEqual({ exitCode: 1, output: [], errors: ["db:verify-first-admin failed"] });
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.end).toHaveBeenCalledOnce();
    expect(result.errors.join(" ")).not.toContain("postgresql://");
  });

  it("fails closed on an invalid count without printing account data", async () => {
    const client = clientWithCount(1);
    client.query.mockImplementation(async (sql: string) =>
      sql.includes("count(*)") ? { rows: [{ admin_count: "one", email: "must-not-print@example.test" }] } : { rows: [] },
    );

    const result = await run(client);

    expect(result).toEqual({ exitCode: 1, output: [], errors: ["db:verify-first-admin failed"] });
    expect(JSON.stringify(result)).not.toContain("must-not-print@example.test");
  });
});
