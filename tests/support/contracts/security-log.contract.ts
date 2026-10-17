import { beforeEach, describe, expect, it } from "vitest";

import type { SecurityEventInput, SecurityLog } from "../../../src/server/services/audit";
import type { AccountId, RequestId } from "../../../src/server/shared";

export interface SecurityLogHarness {
  readonly securityLog: SecurityLog;
  /** Every recorded line, as the object it serializes, oldest first. */
  recorded(): readonly object[];
}

const REQUEST_ID = "33333333-3333-4333-8333-333333333333" as RequestId;
const ACTOR_ID = "44444444-4444-4444-8444-444444444444" as AccountId;

// D-47 outcomes (thegrimbee, 16 October 2026).
const OUTCOMES = [
  ["auth.login_failed", "failed"],
  ["auth.login_throttled", "throttled"],
  ["auth.csrf_failed", "denied"],
  ["access.denied", "denied"],
  ["rate_limit.rejected", "throttled"],
  ["rate_limit.purge_failed", "failed"],
] as const;

/**
 * SecurityLog contract suite (workflow/contracts.md §19 AM-10; D-47). Runs against the recording fake and
 * the console implementation.
 */
export function describeSecurityLogContract(label: string, setup: () => SecurityLogHarness): void {
  describe(`SecurityLog contract — ${label}`, () => {
    let harness: SecurityLogHarness;

    beforeEach(() => {
      harness = setup();
    });

    it.each(OUTCOMES)("records %s with outcome %s", (event, outcome) => {
      harness.securityLog.record({ event, requestId: REQUEST_ID });

      expect(harness.recorded()).toEqual([{ event, outcome, requestId: REQUEST_ID }]);
    });

    it("carries actorId, limit and code when given", () => {
      harness.securityLog.record({
        event: "rate_limit.rejected",
        requestId: REQUEST_ID,
        actorId: ACTOR_ID,
        limit: "review_mutation",
        code: "rate_limited",
      });

      expect(harness.recorded()).toEqual([
        {
          event: "rate_limit.rejected",
          outcome: "throttled",
          requestId: REQUEST_ID,
          actorId: ACTOR_ID,
          limit: "review_mutation",
          code: "rate_limited",
        },
      ]);
    });

    it("records no field beyond the D-47 fields, even when the caller passes extras", () => {
      const withExtras = {
        event: "auth.login_failed",
        requestId: REQUEST_ID,
        email: "someone@example.test",
        ip: "203.0.113.7",
        password: "synthetic-password",
        error: new Error("synthetic stack"),
      } as unknown as SecurityEventInput;

      harness.securityLog.record(withExtras);

      expect(harness.recorded()).toEqual([{ event: "auth.login_failed", outcome: "failed", requestId: REQUEST_ID }]);
    });

    it("omits optional fields that are explicitly undefined", () => {
      harness.securityLog.record({ event: "access.denied", requestId: REQUEST_ID, actorId: undefined, code: undefined });

      expect(Object.keys(harness.recorded()[0] ?? {})).toEqual(["event", "outcome", "requestId"]);
    });

    it("never throws, even for an unknown event", () => {
      const unknown = { event: "auth.unknown", requestId: REQUEST_ID } as unknown as SecurityEventInput;

      expect(() => harness.securityLog.record(unknown)).not.toThrow();
    });
  });
}
