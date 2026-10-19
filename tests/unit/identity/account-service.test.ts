import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createIdentityService,
  hashPassword,
  normalizeEmail,
  parseRegistrationInput,
  validatePassword,
  verifyPassword,
} from "../../../src/server/services/identity";
import type { AccountRecord } from "../../../src/server/repositories/identity";
import type { NewAccount } from "../../../src/server/repositories/identity";
import type { Database } from "../../../src/server/db";
import type { AccountId, RowVersion, Tx } from "../../../src/server/shared";

const tx = {} as Tx;

function databaseFor<T>(value: T) {
  return {
    withTransaction: async () => value,
    withTransactionResult: async <R>(work: (transaction: Tx) => Promise<R>) => work(tx),
    probe: async () => undefined,
  } as unknown as Database;
}

describe("identity account registration", () => {
  it("rejects role injection without calling the repository", async () => {
    const created: unknown[] = [];
    const service = createIdentityService({
      database: {
        withTransaction: async () => {
          throw new Error("should not be called");
        },
        withTransactionResult: async () => {
          throw new Error("should not be called");
        },
        probe: async () => undefined,
      },
      accountRepository: {
        create: async (_tx, input) => {
          created.push(input);
          throw new Error("should not be called");
        },
      },
    });

    const result = await service.register({
      email: "person@example.com",
      password: "correct horse battery staple1!",
      displayName: "Person",
      role: "ADMIN",
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid_fields", fieldErrors: { role: ["unrecognized key"] } },
    });
    expect(created).toHaveLength(0);
  });

  it("normalizes D-50 email boundaries without provider-specific rewrites", () => {
    expect(normalizeEmail("\t USER+tag@Exämple.com \r\n")).toBe("user+tag@xn--exmple-cua.com");
    expect(normalizeEmail("U\u0308SER@XN--EXMPLE-CUA.COM")).toBe("üser@xn--exmple-cua.com");
    expect(normalizeEmail("user.name@gmail.com")).toBe("user.name@gmail.com");
    expect(normalizeEmail(" user+tag@gmail.com ")).toBe("user+tag@gmail.com");

    expect(normalizeEmail("\u00a0user@example.com\u00a0")).toBeNull();
    expect(normalizeEmail("user\u0000@example.com")).toBeNull();
    expect(normalizeEmail("us\u200ber@example.com")).toBeNull();
    expect(normalizeEmail("user @example.com")).toBeNull();
    expect(normalizeEmail("user@exam ple.com")).toBeNull();
    expect(normalizeEmail("user@example_com")).toBeNull();
    expect(normalizeEmail("user@-example.com")).toBeNull();
    expect(normalizeEmail("user@example-.com")).toBeNull();
    expect(normalizeEmail("user@example..com")).toBeNull();
    expect(normalizeEmail("user@example.com.")).toBeNull();
    expect(normalizeEmail("user..name@example.com")).toBeNull();
    expect(normalizeEmail('"user"@example.com')).toBeNull();
    expect(normalizeEmail("user@@example.com")).toBeNull();
  });

  it("accepts 12 and 128 code points, rejects 11 and 129, and verifies without truncation", async () => {
    const eleven = "a".repeat(9) + "1!";
    const twelve = "a".repeat(10) + "1!";
    const oneHundredTwentyEight = "a".repeat(126) + "1!";
    const oneHundredTwentyNine = "a".repeat(127) + "1!";
    expect(validatePassword(eleven)).toBe(false);
    expect(validatePassword(twelve)).toBe(true);
    expect(validatePassword(oneHundredTwentyEight)).toBe(true);
    expect(validatePassword(oneHundredTwentyNine)).toBe(false);
    expect(parseRegistrationInput({ email: "person@example.com", password: eleven, displayName: "Person" }).ok).toBe(false);
    expect(parseRegistrationInput({ email: "person@example.com", password: twelve, displayName: "Person" }).ok).toBe(true);
    expect(parseRegistrationInput({ email: "person@example.com", password: oneHundredTwentyEight, displayName: "Person" }).ok).toBe(true);
    expect(parseRegistrationInput({ email: "person@example.com", password: oneHundredTwentyNine, displayName: "Person" }).ok).toBe(false);

    const password = oneHundredTwentyEight;
    const passwordHash = await hashPassword(password);
    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toContain(password);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, `${"a".repeat(126)}1?`)).resolves.toBe(false);
    await expect(verifyPassword(passwordHash, oneHundredTwentyNine)).resolves.toBe(false);
  });

  it("stores normalized identity and returns only a safe account projection", async () => {
    let stored: NewAccount | undefined;
    const service = createIdentityService({
      database: databaseFor(undefined),
      accountRepository: {
        create: async (_transaction, input) => {
          stored = input;
          return {
            ok: true,
            value: {
              id: "00000000-0000-4000-8000-000000000001" as AccountId,
              normalizedEmail: input.normalizedEmail,
              passwordHash: input.passwordHash,
              displayName: input.displayName,
              role: "USER",
              status: "active",
              version: 1 as RowVersion,
            } satisfies AccountRecord,
          };
        },
      },
    });

    const result = await service.register({
      email: " Person@Example.com ",
      password: "correct horse battery staple1!",
      displayName: " Person ",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        id: "00000000-0000-4000-8000-000000000001",
        displayName: "Person",
        role: "USER",
        status: "active",
        version: 1,
      });
      expect(result.value).not.toHaveProperty("normalizedEmail");
      expect(result.value).not.toHaveProperty("passwordHash");
    }
    expect(stored?.normalizedEmail).toBe("person@example.com");
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
  });
});
