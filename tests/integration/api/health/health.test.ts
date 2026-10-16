import { createServer, type Server, type Socket } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));
// connection() throws outside a Next.js request scope; here every call is a request, so it resolves.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

import { READINESS_PROBE_TIMEOUT_MS } from "../../../../src/server/services/health";
import { expectHealthHeaders, loggedLine } from "../../../unit/health/health-assertions";
import { testDatabaseUrl } from "../../database/test-database";

// Synthetic placeholder values only; none of these are real credentials.
const SESSION_SECRET = "synthetic-session-secret-0123456789abcdef";
const RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-0123456789abcdef";
const SLOW_TEST_TIMEOUT_MS = 15_000;

/** The D-28 core set for a loopback database, with AI disabled and no CRON_SECRET. */
function coreEnv(databaseUrl: string): Record<string, string> {
  return {
    APP_ENV: "test",
    PUBLIC_APP_URL: "http://localhost:3000",
    DATABASE_URL: databaseUrl,
    DATABASE_CA_CERT: "",
    SESSION_SECRET,
    RATE_LIMIT_KEY_SECRET,
    SESSION_TTL_SECONDS: "",
    REPORT_SUSPENSION_THRESHOLD: "",
    CRON_SECRET: "",
    AI_ENABLED: "false",
  };
}

/** Loads the route against a fresh composition root built from `env` (D-23: one per server instance). */
async function routeWith(env: Record<string, string>, route: "live" | "ready"): Promise<{ GET: () => Promise<Response> }> {
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  vi.resetModules();
  return route === "live"
    ? import("../../../../src/app/api/v1/health/live/route")
    : import("../../../../src/app/api/v1/health/ready/route");
}

/** A loopback TCP server that accepts connections and never answers, counting them. */
async function silentServer(): Promise<{ url: string; port: number; connections: () => number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  let accepted = 0;
  const server: Server = createServer((socket) => {
    accepted += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  return {
    url: `postgresql://app_runtime:synthetic-password@127.0.0.1:${port}/postgres`,
    port,
    connections: () => accepted,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

/** A loopback port with nothing listening, so connections are refused. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

function expectNoDetails(text: string, port: number): void {
  expect(text).not.toContain("127.0.0.1");
  expect(text).not.toContain("localhost");
  expect(text).not.toContain(String(port));
  expect(text).not.toContain("synthetic-password");
  expect(text).not.toMatch(/ECONN|timed out|Error/);
}

let consoleError: ReturnType<typeof vi.spyOn>;
const cleanups: (() => Promise<void>)[] = [];

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  consoleError.mockRestore();
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

describe("GET /api/v1/health/ready (AT-26)", () => {
  it("returns 200 with a reachable database while AI is disabled and CRON_SECRET is missing", async () => {
    const { GET } = await routeWith(coreEnv(testDatabaseUrl()), "ready");

    const response = await GET();

    expect(response.status).toBe(200);
    expectHealthHeaders(response);
    expect(await response.text()).toBe('{"status":"ready"}');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("returns 200 when AI is enabled but its configuration is invalid", async () => {
    const { GET } = await routeWith({ ...coreEnv(testDatabaseUrl()), AI_ENABLED: "true", AI_PROVIDER: "" }, "ready");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"status":"ready"}');
  });

  it("returns 503 without opening a connection when core configuration is invalid", async () => {
    const server = await silentServer();
    cleanups.push(server.close);
    const { GET } = await routeWith({ ...coreEnv(server.url), SESSION_SECRET: "" }, "ready");

    const response = await GET();

    expect(response.status).toBe(503);
    const requestId = expectHealthHeaders(response);
    const body = await response.text();
    expect(body).toBe('{"status":"unavailable"}');
    const logged = loggedLine(consoleError.mock.calls);
    expect(logged).toEqual({
      event: "health.ready.unavailable",
      requestId,
      reason: "core_config_invalid",
      variables: ["SESSION_SECRET"],
    });
    expect(server.connections()).toBe(0);
    expectNoDetails(body + JSON.stringify(logged), server.port);
  });

  it("returns 503 and logs database_unavailable when the database refuses connections", async () => {
    const port = await closedPort();
    const { GET } = await routeWith(
      coreEnv(`postgresql://app_runtime:synthetic-password@127.0.0.1:${port}/postgres`),
      "ready",
    );

    const response = await GET();

    expect(response.status).toBe(503);
    const requestId = expectHealthHeaders(response);
    const body = await response.text();
    expect(body).toBe('{"status":"unavailable"}');
    const logged = loggedLine(consoleError.mock.calls);
    expect(logged).toEqual({ event: "health.ready.unavailable", requestId, reason: "database_unavailable" });
    expectNoDetails(body + JSON.stringify(logged), port);
  });

  it(
    "returns 503 within the 2-second limit when the database never answers",
    async () => {
      const server = await silentServer();
      cleanups.push(server.close);
      const { GET } = await routeWith(coreEnv(server.url), "ready");

      const started = performance.now();
      const response = await GET();
      const elapsed = performance.now() - started;

      expect(response.status).toBe(503);
      expect(await response.text()).toBe('{"status":"unavailable"}');
      expect(loggedLine(consoleError.mock.calls).reason).toBe("database_unavailable");
      expect(server.connections()).toBe(1);
      expect(elapsed).toBeGreaterThanOrEqual(READINESS_PROBE_TIMEOUT_MS - 50);
      expect(elapsed).toBeLessThan(READINESS_PROBE_TIMEOUT_MS + 1_000);
    },
    SLOW_TEST_TIMEOUT_MS,
  );
});

describe("GET /api/v1/health/live (AT-26)", () => {
  it("returns 200 while core configuration is invalid", async () => {
    const { GET } = await routeWith({ ...coreEnv(testDatabaseUrl()), SESSION_SECRET: "", DATABASE_URL: "" }, "live");

    const response = await GET();

    expect(response.status).toBe(200);
    expectHealthHeaders(response);
    expect(await response.text()).toBe('{"status":"ok"}');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("returns 200 without touching a database that never answers", async () => {
    const server = await silentServer();
    cleanups.push(server.close);
    const { GET } = await routeWith(coreEnv(server.url), "live");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"status":"ok"}');
    expect(server.connections()).toBe(0);
  });
});
