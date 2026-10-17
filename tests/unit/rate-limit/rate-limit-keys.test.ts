import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import {
  createRateLimitKeys,
  RATE_LIMIT_POLICIES,
  type RateLimitName,
} from "../../../src/server/services/rate-limit";
import type { AccountId } from "../../../src/server/shared";

// Synthetic values only.
const SECRET = "synthetic-rate-limit-key-secret-0123456789";
const OTHER_SECRET = "synthetic-rate-limit-key-secret-9876543210";
const EMAIL = "someone@example.test";
const IP = "203.0.113.7";
const ACCOUNT_ID = "6F1C2B3A-4D5E-4F60-8A7B-9C0D1E2F3A4B" as AccountId;

/** Independent reference for D-44: lowercase hex HMAC-SHA256 over the UTF-8 string. */
function referenceHmac(secret: string, input: string): string {
  return createHmac("sha256", secret).update(input, "utf8").digest("hex");
}

describe("createRateLimitKeys (D-44)", () => {
  const keys = createRateLimitKeys({ secret: SECRET });

  it("builds an account key from the lower-case UUID", () => {
    expect(keys.forAccount("review_mutation", ACCOUNT_ID)).toBe(
      "review_mutation:account:6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    );
  });

  it("builds the environment key", () => {
    expect(keys.forEnvironment("soc_requests")).toBe("soc_requests:env");
  });

  it("builds an email key from the HMAC of <limit>:email:<normalized email>", () => {
    expect(keys.forEmail("login_failure_email", EMAIL)).toBe(
      `login_failure_email:email:${referenceHmac(SECRET, `login_failure_email:email:${EMAIL}`)}`,
    );
  });

  it("builds an IP key from the HMAC of <limit>:ip:<ip>", () => {
    expect(keys.forClientIp("login_failure_ip", IP)).toBe(
      `login_failure_ip:ip:${referenceHmac(SECRET, `login_failure_ip:ip:${IP}`)}`,
    );
  });

  it("hashes the placeholder IP like any other", () => {
    expect(keys.forClientIp("login_failure_ip", "unknown")).toBe(
      `login_failure_ip:ip:${referenceHmac(SECRET, "login_failure_ip:ip:unknown")}`,
    );
  });

  it("hashes non-ASCII input as UTF-8", () => {
    const email = "zoë@example.test";
    expect(keys.forEmail("login_failure_email", email)).toBe(
      `login_failure_email:email:${referenceHmac(SECRET, `login_failure_email:email:${email}`)}`,
    );
  });

  it("emits a 64-character lower-case hex subject that contains neither the email nor the IP", () => {
    const emailKey = keys.forEmail("login_failure_email", EMAIL);
    const ipKey = keys.forClientIp("login_failure_ip", IP);

    expect(emailKey).toMatch(/^login_failure_email:email:[0-9a-f]{64}$/);
    expect(ipKey).toMatch(/^login_failure_ip:ip:[0-9a-f]{64}$/);
    expect(emailKey).not.toContain(EMAIL);
    expect(emailKey).not.toContain("example");
    expect(ipKey).not.toContain(IP);
  });

  it("binds the HMAC to the limit name", () => {
    const [, , first] = keys.forEmail("login_failure_email", EMAIL).split(":");
    const [, , second] = keys.forEmail("login_failure_ip", EMAIL).split(":");

    expect(first).not.toBe(second);
  });

  it("separates email and IP subjects with the same value", () => {
    const [, , email] = keys.forEmail("login_failure_ip", IP).split(":");
    const [, , ip] = keys.forClientIp("login_failure_ip", IP).split(":");

    expect(email).not.toBe(ip);
  });

  it("changes the email and IP keys when the secret changes, but not the account or environment keys", () => {
    const rotated = createRateLimitKeys({ secret: OTHER_SECRET });

    expect(rotated.forEmail("login_failure_email", EMAIL)).not.toBe(keys.forEmail("login_failure_email", EMAIL));
    expect(rotated.forClientIp("login_failure_ip", IP)).not.toBe(keys.forClientIp("login_failure_ip", IP));
    expect(rotated.forAccount("report_create", ACCOUNT_ID)).toBe(keys.forAccount("report_create", ACCOUNT_ID));
    expect(rotated.forEnvironment("soc_requests")).toBe(keys.forEnvironment("soc_requests"));
  });

  it("is deterministic", () => {
    expect(createRateLimitKeys({ secret: SECRET }).forEmail("login_failure_email", EMAIL)).toBe(
      keys.forEmail("login_failure_email", EMAIL),
    );
  });

  it("does not expose the secret", () => {
    expect(JSON.stringify(keys)).not.toContain(SECRET);
    expect(Object.keys(keys).sort()).toEqual(["forAccount", "forClientIp", "forEmail", "forEnvironment"]);
  });
});

describe("RATE_LIMIT_POLICIES (D-44)", () => {
  it("holds the D-44 fixed policies and nothing else", () => {
    expect(RATE_LIMIT_POLICIES).toEqual({
      login_failure_email: { limit: 5, windowSeconds: 900 },
      login_failure_ip: { limit: 5, windowSeconds: 900 },
      review_mutation: { limit: 10, windowSeconds: 60 },
      report_create: { limit: 5, windowSeconds: 3_600 },
    } satisfies Partial<Record<RateLimitName, unknown>>);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(RATE_LIMIT_POLICIES)).toBe(true);
    expect(Object.isFrozen(RATE_LIMIT_POLICIES.review_mutation)).toBe(true);
  });
});
