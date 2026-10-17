import "server-only";

import { createHmac } from "node:crypto";

import type { RateLimitKey, RateLimitKeys, RateLimitName } from "./types";

/**
 * D-44 `bucket_key` builder: `<limit name>:<subject>`. Email and IP subjects are lowercase hex
 * HMAC-SHA256 under `RATE_LIMIT_KEY_SECRET` over `<limit name>:email:<email>` or `<limit name>:ip:<ip>`, so
 * the stored key never holds the raw value (D-12). Account UUIDs are stored raw, in lower case.
 */
export function createRateLimitKeys(deps: { secret: string }): RateLimitKeys {
  const { secret } = deps;

  function hashed(limit: RateLimitName, subject: "email" | "ip", value: string): RateLimitKey {
    const prefix = `${limit}:${subject}:`;
    const hmac = createHmac("sha256", secret).update(`${prefix}${value}`, "utf8").digest("hex");
    return `${prefix}${hmac}` as RateLimitKey;
  }

  return {
    forAccount: (limit, accountId) => `${limit}:account:${accountId.toLowerCase()}` as RateLimitKey,
    forEmail: (limit, normalizedEmail) => hashed(limit, "email", normalizedEmail),
    forClientIp: (limit, ip) => hashed(limit, "ip", ip),
    forEnvironment: (limit) => `${limit}:env` as RateLimitKey,
  };
}
