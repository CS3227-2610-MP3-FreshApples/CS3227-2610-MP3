import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import {
  assessReadiness,
  READINESS_PROBE_TIMEOUT_MS,
  readinessUnavailableLogLine,
} from "../../../src/server/services/health";

const REQUEST_ID = "00000000-0000-4000-8000-000000000000";
// Synthetic sensitive-looking text that must never reach a result or a log line.
const PROBE_ERROR_TEXT = "connect ECONNREFUSED db.secret-host.example:6543 password=synthetic";

afterEach(() => {
  vi.useRealTimers();
});

describe("assessReadiness — invalid core configuration", () => {
  it("is unavailable with reason core_config_invalid and the variable names", async () => {
    const result = await assessReadiness({ invalidCoreVariables: ["SESSION_SECRET", "DATABASE_URL"] });

    expect(result).toEqual({
      ready: false,
      reason: "core_config_invalid",
      variables: ["SESSION_SECRET", "DATABASE_URL"],
    });
  });

  it("lists each variable once, in first-seen order", async () => {
    const result = await assessReadiness({ invalidCoreVariables: ["DATABASE_URL", "APP_ENV", "DATABASE_URL"] });

    expect(result).toEqual({ ready: false, reason: "core_config_invalid", variables: ["DATABASE_URL", "APP_ENV"] });
  });
});

describe("assessReadiness — valid core configuration", () => {
  it("is ready when the probe resolves, calling it exactly once", async () => {
    const probe = vi.fn(() => Promise.resolve());

    await expect(assessReadiness({ probe })).resolves.toEqual({ ready: true });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("is unavailable with reason database_unavailable when the probe rejects", async () => {
    const probe = vi.fn(() => Promise.reject(new Error(PROBE_ERROR_TEXT)));

    const result = await assessReadiness({ probe });

    expect(result).toEqual({ ready: false, reason: "database_unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret-host");
  });

  it("is unavailable with reason database_unavailable when the probe throws synchronously", async () => {
    const probe = vi.fn((): Promise<void> => {
      throw new Error(PROBE_ERROR_TEXT);
    });

    await expect(assessReadiness({ probe })).resolves.toEqual({ ready: false, reason: "database_unavailable" });
  });

  it("uses a 2-second probe limit (D-36)", () => {
    expect(READINESS_PROBE_TIMEOUT_MS).toBe(2_000);
  });

  it("is unavailable when the probe has not settled after 2 seconds", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(() => new Promise<void>(() => undefined));
    let settled: unknown;
    const pending = assessReadiness({ probe }).then((result) => {
      settled = result;
    });

    await vi.advanceTimersByTimeAsync(READINESS_PROBE_TIMEOUT_MS - 1);
    expect(settled).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toEqual({ ready: false, reason: "database_unavailable" });
  });

  it("is unavailable when the probe resolves only after 2 seconds", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, READINESS_PROBE_TIMEOUT_MS + 500)),
    );
    const pending = assessReadiness({ probe });

    await vi.advanceTimersByTimeAsync(READINESS_PROBE_TIMEOUT_MS + 500);

    await expect(pending).resolves.toEqual({ ready: false, reason: "database_unavailable" });
  });

  it("leaves no timer pending once the probe resolves", async () => {
    vi.useFakeTimers();

    await assessReadiness({ probe: () => Promise.resolve() });

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("readinessUnavailableLogLine (D-39)", () => {
  it("writes the configuration failure with its variable names", () => {
    const line = readinessUnavailableLogLine(REQUEST_ID, {
      ready: false,
      reason: "core_config_invalid",
      variables: ["SESSION_SECRET"],
    });

    expect(JSON.parse(line)).toEqual({
      event: "health.ready.unavailable",
      requestId: REQUEST_ID,
      reason: "core_config_invalid",
      variables: ["SESSION_SECRET"],
    });
  });

  it.each(["database_unavailable", "unexpected_error"] as const)("writes %s without a variables field", (reason) => {
    const line = readinessUnavailableLogLine(REQUEST_ID, { ready: false, reason });

    expect(JSON.parse(line)).toEqual({ event: "health.ready.unavailable", requestId: REQUEST_ID, reason });
  });

  it("is a single line", () => {
    const line = readinessUnavailableLogLine(REQUEST_ID, { ready: false, reason: "database_unavailable" });

    expect(line).not.toContain("\n");
  });
});
