import { beforeEach, describe, expect, it } from "vitest";

import type { AuditEntryInput, AuditLog } from "../../../src/server/services/audit";
import type { AccountId, RequestId } from "../../../src/server/shared";

/** One stored audit entry, in the AuditEntryInput shape, as read back from the implementation under test. */
export interface StoredAuditEntry {
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly result: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly requestId: string;
}

export interface AuditLogHarness {
  readonly auditLog: AuditLog;
  /** An account id the implementation accepts as an actor (the real table has a foreign key). */
  readonly actorId: AccountId;
  /** Calls `auditLog.record` inside a transaction that commits if it resolves. */
  record(entry: AuditEntryInput): Promise<void>;
  /** Every stored entry, oldest first. */
  stored(): Promise<readonly StoredAuditEntry[]>;
}

// Synthetic identifiers (RFC 9562 version 4 layout).
export const TARGET_ID = "11111111-1111-4111-8111-111111111111";
export const REQUEST_ID = "22222222-2222-4222-8222-222222222222" as RequestId;

/** D-46 forbidden key names, in their canonical lower-case, underscore-free form. */
export const FORBIDDEN_KEYS = [
  "password",
  "passwordhash",
  "token",
  "sessiontoken",
  "csrftoken",
  "secret",
  "email",
  "body",
  "explanation",
  "snapshot",
  "evidencesnapshot",
  "prompt",
  "response",
  "output",
] as const;

/** Spellings of each forbidden name that must also be rejected: camelCase and snake_case. */
const FORBIDDEN_VARIANTS = ["passwordHash", "password_hash", "sessionToken", "session_token", "csrf_Token", "evidence_Snapshot", "e_mail"];

/**
 * K5 contract suite (workflow/contracts.md §8, §19 AM-09; D-46). Runs against the in-memory fake and the
 * PostgreSQL implementation, so both accept and reject exactly the same entries.
 */
export function describeAuditLogContract(label: string, setup: () => Promise<AuditLogHarness>): void {
  describe(`AuditLog contract — ${label}`, () => {
    let harness: AuditLogHarness;

    beforeEach(async () => {
      harness = await setup();
    });

    function validEntry(overrides: Partial<Record<keyof AuditEntryInput, unknown>> = {}): AuditEntryInput {
      return {
        actorId: harness.actorId,
        action: "review.hide",
        targetType: "review",
        targetId: TARGET_ID,
        result: "applied",
        metadata: { reason: "Synthetic admin reason.", fromHidden: false, version: 3, previous: null },
        requestId: REQUEST_ID,
        ...overrides,
      } as AuditEntryInput;
    }

    async function expectRejected(entry: AuditEntryInput): Promise<void> {
      await expect(harness.record(entry)).rejects.toThrow("invalid audit entry");
      expect(await harness.stored()).toEqual([]);
    }

    it("stores a valid entry with every field", async () => {
      await harness.record(validEntry());

      expect(await harness.stored()).toEqual([
        {
          actorId: harness.actorId,
          action: "review.hide",
          targetType: "review",
          targetId: TARGET_ID,
          result: "applied",
          metadata: { reason: "Synthetic admin reason.", fromHidden: false, version: 3, previous: null },
          requestId: REQUEST_ID,
        },
      ]);
    });

    it("stores a system entry with a null actor, a no_op result and empty metadata", async () => {
      await harness.record(validEntry({ actorId: null, action: "review.auto_clear", result: "no_op", metadata: {} }));

      expect(await harness.stored()).toMatchObject([
        { actorId: null, action: "review.auto_clear", result: "no_op", metadata: {} },
      ]);
    });

    it("stores entries in call order and never drops one", async () => {
      await harness.record(validEntry({ action: "report.accept", targetType: "report" }));
      await harness.record(validEntry({ action: "account.suspend", targetType: "account" }));

      expect((await harness.stored()).map((entry) => entry.action)).toEqual(["report.accept", "account.suspend"]);
    });

    describe("vocabularies (§8 unions)", () => {
      it("rejects an unknown action", () => expectRejected(validEntry({ action: "review.delete" })));
      it("rejects an unknown target type", () => expectRejected(validEntry({ targetType: "session" })));
      it("rejects an unknown result", () => expectRejected(validEntry({ result: "denied" })));
      it("rejects an action in a different case", () => expectRejected(validEntry({ action: "REVIEW.HIDE" })));
    });

    describe("identifiers", () => {
      it("rejects a non-UUID target id", () => expectRejected(validEntry({ targetId: "review-1" })));
      it("rejects a non-UUID actor id", () => expectRejected(validEntry({ actorId: "admin" })));
      it("rejects a non-UUID request id", () => expectRejected(validEntry({ requestId: "req-123" })));
      it("rejects an empty request id", () => expectRejected(validEntry({ requestId: "" })));
      it("rejects an undefined actor id (null is the system actor)", () =>
        expectRejected(validEntry({ actorId: undefined })));
    });

    describe("entry shape", () => {
      it("rejects an unknown top-level field", () =>
        expectRejected({ ...validEntry(), createdAt: new Date() } as AuditEntryInput));
      it("rejects a missing metadata object", () => expectRejected(validEntry({ metadata: undefined })));
    });

    describe("metadata", () => {
      it("rejects nested object values", () => expectRejected(validEntry({ metadata: { before: { hidden: false } } })));
      it("rejects array values", () => expectRejected(validEntry({ metadata: { ids: [TARGET_ID] } })));
      it("rejects an array as the metadata object", () => expectRejected(validEntry({ metadata: [] })));
      it("rejects a Date value", () => expectRejected(validEntry({ metadata: { at: new Date() } })));
      it("rejects an undefined value", () => expectRejected(validEntry({ metadata: { reason: undefined } })));
      it("rejects Infinity", () => expectRejected(validEntry({ metadata: { count: Number.POSITIVE_INFINITY } })));
      it("rejects NaN", () => expectRejected(validEntry({ metadata: { count: Number.NaN } })));

      it("accepts 20 keys and rejects 21", async () => {
        const keys = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, i]));
        await harness.record(validEntry({ metadata: keys(20) }));
        expect(await harness.stored()).toHaveLength(1);

        await expect(harness.record(validEntry({ metadata: keys(21) }))).rejects.toThrow("invalid audit entry");
        expect(await harness.stored()).toHaveLength(1);
      });

      it("accepts a string of 1,000 code points, counted as code points not UTF-16 units", async () => {
        const astral = "\u{1F3AC}".repeat(1000); // 2,000 UTF-16 units
        await harness.record(validEntry({ metadata: { reason: astral } }));
        expect((await harness.stored())[0]?.metadata).toEqual({ reason: astral });
      });

      it("rejects a string of 1,001 code points", () =>
        expectRejected(validEntry({ metadata: { reason: "a".repeat(1001) } })));

      it("accepts a 64-character key", async () => {
        await harness.record(validEntry({ metadata: { [`a${"b".repeat(63)}`]: true } }));
        expect(await harness.stored()).toHaveLength(1);
      });

      it.each([
        ["a 65-character key", `a${"b".repeat(64)}`],
        ["an upper-case first letter", "Reason"],
        ["a leading digit", "1reason"],
        ["a leading underscore", "_reason"],
        ["a hyphen", "admin-reason"],
        ["an empty key", ""],
      ])("rejects %s", (_, key) => expectRejected(validEntry({ metadata: { [key]: "x" } })));

      it.each(FORBIDDEN_KEYS)("rejects the forbidden key %s", (key) => expectRejected(validEntry({ metadata: { [key]: "x" } })));

      it.each(FORBIDDEN_VARIANTS)("rejects the forbidden-key spelling %s", (key) =>
        expectRejected(validEntry({ metadata: { [key]: "x" } })));

      it("allows a key that only contains a forbidden name", async () => {
        await harness.record(validEntry({ metadata: { emailVerified: true, bodyLength: 120 } }));
        expect(await harness.stored()).toHaveLength(1);
      });
    });

    it("does not echo rejected values in the error message", async () => {
      const sensitive = "synthetic-password-value";
      await expect(harness.record(validEntry({ metadata: { password: sensitive } }))).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(sensitive) }),
      );
    });
  });
}
