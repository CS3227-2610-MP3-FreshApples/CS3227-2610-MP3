import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { createConsoleSecurityLog } from "../../../src/server/services/audit";
import type { RequestId } from "../../../src/server/shared";
import { describeSecurityLogContract } from "../../support/contracts/security-log.contract";
import { createRecordingSecurityLog } from "../../support/fakes/security-log";

const REQUEST_ID = "66666666-6666-4666-8666-666666666666" as RequestId;

afterEach(() => {
  vi.restoreAllMocks();
});

describeSecurityLogContract("recording fake", () => {
  const securityLog = createRecordingSecurityLog();
  return { securityLog, recorded: () => securityLog.records };
});

describeSecurityLogContract("console", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  return {
    securityLog: createConsoleSecurityLog(),
    recorded: () =>
      warn.mock.calls.map((args) => {
        expect(args).toHaveLength(1);
        expect(typeof args[0]).toBe("string");
        return JSON.parse(args[0] as string) as Record<string, unknown>;
      }),
  };
});

describe("createConsoleSecurityLog", () => {
  it("writes exactly one single-line JSON string per event with console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    createConsoleSecurityLog().record({ event: "access.denied", requestId: REQUEST_ID, code: "forbidden" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe(
      `{"event":"access.denied","outcome":"denied","requestId":"${REQUEST_ID}","code":"forbidden"}`,
    );
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("never throws when console.warn throws", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("synthetic console failure");
    });

    expect(() => createConsoleSecurityLog().record({ event: "auth.login_failed", requestId: REQUEST_ID })).not.toThrow();
  });

  it("never throws when a field getter throws", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hostile = {
      event: "auth.login_failed",
      get requestId(): never {
        throw new Error("synthetic getter failure");
      },
    } as unknown as Parameters<ReturnType<typeof createConsoleSecurityLog>["record"]>[0];

    expect(() => createConsoleSecurityLog().record(hostile)).not.toThrow();
  });
});
