import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  clientIpFromVercelHeaders,
  placeholderClientIp,
} from "../../../src/server/http";

describe("D-44 client-IP resolvers", () => {
  it("trims x-real-ip and maps an absent or empty value to unknown", () => {
    expect(clientIpFromVercelHeaders(new Headers({ "x-real-ip": " 203.0.113.7 " }))).toBe("203.0.113.7");
    expect(clientIpFromVercelHeaders(new Headers())).toBe("unknown");
    expect(clientIpFromVercelHeaders(new Headers({ "x-real-ip": "   " }))).toBe("unknown");
  });

  it("ignores x-forwarded-for and every header other than x-real-ip", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.40",
      forwarded: "for=198.51.100.41",
      "cf-connecting-ip": "198.51.100.42",
    });

    expect(clientIpFromVercelHeaders(headers)).toBe("unknown");
  });

  it("uses the fixed placeholder regardless of supplied headers", () => {
    expect(placeholderClientIp(new Headers({ "x-real-ip": "203.0.113.8" }))).toBe("unknown");
  });
});

describe("D-44 composition selection", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it.each(["local", "test"] as const)("injects the placeholder resolver in %s", async (appEnv) => {
    process.env = validEnvironment(appEnv);
    vi.resetModules();
    const composition = await import("../../../src/server/composition");

    expect(composition.clientIpResolver(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("unknown");
  });

  it.each(["development", "production"] as const)("injects the hosted resolver in %s", async (appEnv) => {
    process.env = validEnvironment(appEnv);
    vi.resetModules();
    const composition = await import("../../../src/server/composition");

    expect(composition.clientIpResolver(new Headers({ "x-real-ip": " 203.0.113.10 " }))).toBe("203.0.113.10");
  });
});

function validEnvironment(appEnv: "local" | "test" | "development" | "production"): NodeJS.ProcessEnv {
  const hosted = appEnv === "development" || appEnv === "production";
  return {
    NODE_ENV: "test",
    APP_ENV: appEnv,
    PUBLIC_APP_URL: hosted ? "https://app.example.test" : "http://localhost:3000",
    DATABASE_URL: "postgresql://postgres:synthetic@127.0.0.1:5432/postgres",
    DATABASE_CA_CERT: hosted ? "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----" : undefined,
    SESSION_SECRET: "session-secret-that-is-long-enough-for-tests",
    RATE_LIMIT_KEY_SECRET: "rate-limit-secret-that-is-different-for-tests",
    AI_ENABLED: "false",
  };
}
