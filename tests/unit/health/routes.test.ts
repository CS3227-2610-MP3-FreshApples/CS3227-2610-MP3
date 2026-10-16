import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: vi.fn(() => Promise.resolve()) }));
// The composition root reads process.env and opens a pool; route tests replace it with a stub.
vi.mock("../../../src/server/composition", () => ({ checkReadiness: vi.fn() }));

import { connection } from "next/server";

import * as liveRoute from "../../../src/app/api/v1/health/live/route";
import * as readyRoute from "../../../src/app/api/v1/health/ready/route";
import { checkReadiness } from "../../../src/server/composition";
import {
  callWithRequest,
  expectHealthHeaders,
  loggedLine,
  requestWithClientHeaders,
} from "./health-assertions";

const connectionMock = vi.mocked(connection);
const checkReadinessMock = vi.mocked(checkReadiness);
const PROBE_ERROR_TEXT = "connect ECONNREFUSED db.secret-host.example:6543 password=synthetic";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  connectionMock.mockReset().mockResolvedValue(undefined);
  checkReadinessMock.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((done) => {
    resolvePromise = done;
  });
  return { promise, resolve: resolvePromise };
}

function importSpecifiers(file: string): string[] {
  const source = readFileSync(resolve("src/app/api/v1/health", file), "utf8");
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? match[2],
  );
}

describe.each([
  ["live", liveRoute],
  ["ready", readyRoute],
])("health/%s route module", (directory, routeModule) => {
  it("exports only GET, so HEAD is served by GET and OPTIONS is framework-generated (D-38)", () => {
    // No `runtime` export: cacheComponents rejects it and always uses the Node.js runtime.
    expect(Object.keys(routeModule)).toEqual(["GET"]);
  });

  it("imports nothing from the API kernel (K2), sessions or adapters", () => {
    for (const specifier of importSpecifiers(`${directory}/route.ts`)) {
      expect(specifier).not.toMatch(/server\/(http|adapters|repositories)|identity|session/);
    }
  });
});

describe("GET /api/v1/health/live", () => {
  it("imports nothing from the composition root, configuration, database or adapters", () => {
    const specifiers = [...importSpecifiers("live/route.ts"), ...importSpecifiers("health-response.ts")];

    expect(specifiers).toEqual(["next/server", "../health-response", "node:crypto"]);
  });

  it("returns exactly 200 {\"status\":\"ok\"} with the health headers", async () => {
    const response = await liveRoute.GET();

    expect(response.status).toBe(200);
    expectHealthHeaders(response);
    expect(await response.text()).toBe('{"status":"ok"}');
  });

  it("never runs the readiness check", async () => {
    await liveRoute.GET();

    expect(checkReadinessMock).not.toHaveBeenCalled();
  });

  it("waits for connection() before responding", async () => {
    const gate = deferred();
    connectionMock.mockReturnValueOnce(gate.promise);
    let settled = false;
    const pending = liveRoute.GET().then((response) => {
      settled = true;
      return response;
    });

    await Promise.resolve();
    expect(connectionMock).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    gate.resolve();
    expect((await pending).status).toBe(200);
  });

  it("ignores the inbound request ID, cookies and session headers", async () => {
    const response = await callWithRequest(liveRoute.GET, requestWithClientHeaders("/api/v1/health/live"));

    expect(expectHealthHeaders(response)).not.toBe("client-supplied-request-id");
    expect(await response.text()).toBe('{"status":"ok"}');
  });

  it("generates a fresh request ID per response", async () => {
    const first = expectHealthHeaders(await liveRoute.GET());
    const second = expectHealthHeaders(await liveRoute.GET());

    expect(first).not.toBe(second);
  });

  it("logs nothing", async () => {
    await liveRoute.GET();

    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/health/ready", () => {
  it("returns exactly 200 {\"status\":\"ready\"} and logs nothing when ready", async () => {
    checkReadinessMock.mockResolvedValue({ ready: true });

    const response = await readyRoute.GET();

    expect(response.status).toBe(200);
    expectHealthHeaders(response);
    expect(await response.text()).toBe('{"status":"ready"}');
    expect(checkReadinessMock).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("returns 503 and logs the variable names when core configuration is invalid", async () => {
    checkReadinessMock.mockResolvedValue({
      ready: false,
      reason: "core_config_invalid",
      variables: ["SESSION_SECRET", "DATABASE_URL"],
    });

    const response = await readyRoute.GET();

    expect(response.status).toBe(503);
    const requestId = expectHealthHeaders(response);
    expect(await response.text()).toBe('{"status":"unavailable"}');
    expect(loggedLine(consoleError.mock.calls)).toEqual({
      event: "health.ready.unavailable",
      requestId,
      reason: "core_config_invalid",
      variables: ["SESSION_SECRET", "DATABASE_URL"],
    });
  });

  it("returns 503 and logs database_unavailable when the database is unavailable", async () => {
    checkReadinessMock.mockResolvedValue({ ready: false, reason: "database_unavailable" });

    const response = await readyRoute.GET();

    expect(response.status).toBe(503);
    const requestId = expectHealthHeaders(response);
    expect(await response.text()).toBe('{"status":"unavailable"}');
    expect(loggedLine(consoleError.mock.calls)).toEqual({
      event: "health.ready.unavailable",
      requestId,
      reason: "database_unavailable",
    });
  });

  it("returns 503 and logs unexpected_error, without the error text, when the check throws", async () => {
    checkReadinessMock.mockRejectedValue(new Error(PROBE_ERROR_TEXT));

    const response = await readyRoute.GET();

    expect(response.status).toBe(503);
    const requestId = expectHealthHeaders(response);
    const body = await response.text();
    expect(body).toBe('{"status":"unavailable"}');
    const logged = loggedLine(consoleError.mock.calls);
    expect(logged).toEqual({ event: "health.ready.unavailable", requestId, reason: "unexpected_error" });
    for (const text of [body, JSON.stringify(logged)]) {
      expect(text).not.toContain("secret-host");
      expect(text).not.toContain("ECONNREFUSED");
      expect(text).not.toContain("password");
    }
  });

  it("returns 503 when the check throws synchronously", async () => {
    checkReadinessMock.mockImplementation(() => {
      throw new Error(PROBE_ERROR_TEXT);
    });

    const response = await readyRoute.GET();

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"unavailable"}');
    expect(loggedLine(consoleError.mock.calls).reason).toBe("unexpected_error");
  });

  it("waits for connection() before running the readiness check", async () => {
    const gate = deferred();
    connectionMock.mockReturnValueOnce(gate.promise);
    checkReadinessMock.mockResolvedValue({ ready: true });
    const pending = readyRoute.GET();

    await Promise.resolve();
    expect(connectionMock).toHaveBeenCalledTimes(1);
    expect(checkReadinessMock).not.toHaveBeenCalled();

    gate.resolve();
    expect((await pending).status).toBe(200);
    expect(checkReadinessMock).toHaveBeenCalledTimes(1);
  });

  it("ignores the inbound request ID, cookies and session headers", async () => {
    checkReadinessMock.mockResolvedValue({ ready: false, reason: "database_unavailable" });

    const response = await callWithRequest(readyRoute.GET, requestWithClientHeaders("/api/v1/health/ready"));

    const requestId = expectHealthHeaders(response);
    expect(requestId).not.toBe("client-supplied-request-id");
    expect(loggedLine(consoleError.mock.calls).requestId).toBe(requestId);
  });

  it("generates a fresh request ID per response", async () => {
    checkReadinessMock.mockResolvedValue({ ready: true });

    const first = expectHealthHeaders(await readyRoute.GET());
    const second = expectHealthHeaders(await readyRoute.GET());

    expect(first).not.toBe(second);
  });
});
