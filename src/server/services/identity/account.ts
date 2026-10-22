import "server-only";

import { hash, verify } from "@node-rs/argon2";
import { domainToASCII } from "node:url";
import { z } from "zod";

import type { Database } from "../../db";
import { ServiceUnavailableError, TransactionConflict, type DomainError, type FieldErrors, type Result } from "../../shared";
import {
  type AccountRecord,
  type AccountRepository,
  type NewAccount,
} from "../../repositories/identity";
import { validatePassword } from "./password-policy";

export const ADMIN_USER_STATUSES = ["active", "suspended"] as const;
export type AdminUserStatusFilter = (typeof ADMIN_USER_STATUSES)[number];

export interface AdminUserFilters {
  readonly status: AdminUserStatusFilter | null;
  readonly q: string | null;
}

export function parseAdminUserFilters(query: URLSearchParams): Result<AdminUserFilters, FieldErrors> {
  const errors: Record<string, string[]> = {};
  const rawStatus = query.get("status");
  const rawQuery = query.get("q");
  const status = rawStatus === null ? null : ADMIN_USER_STATUSES.includes(rawStatus as AdminUserStatusFilter) ? rawStatus as AdminUserStatusFilter : null;
  const q = rawQuery === null ? null : rawQuery.trim();

  if (rawStatus !== null && status === null) errors.status = ["invalid status filter"];
  if (q !== null && Array.from(q).length > 200) errors.q = ["must be at most 200 characters"];
  if (Object.keys(errors).length > 0) return { ok: false, error: errors };
  return { ok: true, value: { status, q: q === null || q.length === 0 ? null : q } };
}

export { validatePassword };

const ASCII_WHITESPACE = /^[\x09-\x0d\x20]+|[\x09-\x0d\x20]+$/g;

const rawRegistrationSchema = z
  .object({
    email: z.string(),
    password: z.string(),
    displayName: z.string(),
  })
  .strict();

export interface RegistrationInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export function parseRegistrationInput(input: unknown): Result<RegistrationInput, FieldErrors> {
  const parsed = rawRegistrationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: registrationFieldErrors(parsed.error) };
  const normalizedEmail = normalizeEmail(parsed.data.email);
  const displayName = parsed.data.displayName.trim();
  const fieldErrors: FieldErrors = {
    ...(normalizedEmail === null ? { email: ["invalid email"] } : {}),
    ...(!validatePassword(parsed.data.password) ? { password: ["must be 12 to 128 characters and include a number and special character"] } : {}),
    ...(!isValidDisplayName(displayName) ? { displayName: ["must be 1 to 60 characters"] } : {}),
  };
  return Object.keys(fieldErrors).length === 0
    ? { ok: true, value: parsed.data }
    : { ok: false, error: fieldErrors };
}

export interface SafeAccount {
  readonly id: AccountRecord["id"];
  readonly displayName: string;
  readonly role: AccountRecord["role"];
  readonly status: AccountRecord["status"];
  readonly version: AccountRecord["version"];
}

export interface IdentityService {
  register(input: unknown): Promise<Result<SafeAccount, DomainError>>;
}

export interface IdentityServiceDependencies {
  readonly database: Database;
  readonly accountRepository: Pick<AccountRepository, "create">;
}

/** Validate registration without hashing or writing, allowing transport protections to run first. */
export function validateRegistrationInput(input: unknown): DomainError | null {
  const parsed = parseRegistrationInput(input);
  return parsed.ok ? null : { kind: "invalid_fields", fieldErrors: parsed.error };
}

export function normalizeEmail(input: string): string | null {
  const email = input.replace(ASCII_WHITESPACE, "");
  if (
    email.length === 0 ||
    email.length > 254 ||
    /[\p{Cc}\p{Cf}]/u.test(email) ||
    /\s/u.test(email) ||
    (email.match(/@/g) ?? []).length !== 1
  ) {
    return null;
  }

  const at = email.indexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (
    local.length === 0 ||
    new TextEncoder().encode(local).length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    /["()<>:,;[\]\\]/u.test(local)
  ) {
    return null;
  }

  const asciiDomain = toAsciiDomain(domain);
  if (asciiDomain === null || asciiDomain.length > 253) {
    return null;
  }
  return `${local.normalize("NFC").toLowerCase()}@${asciiDomain}`;
}

function toAsciiDomain(domain: string): string | null {
  if (domain.length === 0 || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return null;
  }
  const ascii = domainToASCII(domain).toLowerCase();
  if (
    ascii.length === 0 ||
    ascii.split(".").some((label) =>
      label.length === 0 ||
      label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    )
  ) {
    return null;
  }
  return ascii;
}

export async function hashPassword(password: string): Promise<string> {
  if (!validatePassword(password)) {
    throw new Error("password must be 12 to 128 characters and include a number and special character");
  }
  return hash(password, { algorithm: 2 });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  if (!validatePassword(password)) {
    return false;
  }
  return verify(passwordHash, password);
}

export function safeAccountProjection(account: AccountRecord): SafeAccount {
  return {
    id: account.id,
    displayName: account.displayName,
    role: account.role,
    status: account.status,
    version: account.version,
  };
}

export function createIdentityService({ database, accountRepository }: IdentityServiceDependencies): IdentityService {
  return {
    async register(input) {
      const parsedResult = parseRegistrationInput(input);
      if (!parsedResult.ok) return { ok: false, error: { kind: "invalid_fields", fieldErrors: parsedResult.error } };
      const parsed = parsedResult.value;
      const normalizedEmail = normalizeEmail(parsed.email);
      const displayName = parsed.displayName.trim();
      if (normalizedEmail === null) return { ok: false, error: { kind: "invalid_fields", fieldErrors: { email: ["invalid email"] } } };

      const passwordHash = await hashPassword(parsed.password);
      let account: Result<AccountRecord, { readonly kind: "conflict" }>;
      try {
        account = await database.withTransactionResult(async (tx) => {
          const inputToStore: NewAccount = { normalizedEmail, passwordHash, displayName };
          return accountRepository.create(tx, inputToStore);
        });
      } catch (error) {
        if (error instanceof TransactionConflict || error instanceof ServiceUnavailableError) throw error;
        throw new ServiceUnavailableError();
      }
      if (!account.ok) {
        return { ok: false, error: { kind: "conflict" } };
      }
      return { ok: true, value: safeAccountProjection(account.value) };
    },
  };
}

function isValidDisplayName(displayName: string): boolean {
  return Array.from(displayName).length >= 1 && Array.from(displayName).length <= 60 && !/[\p{Cc}\p{Cf}]/u.test(displayName);
}

function registrationFieldErrors(error: z.ZodError): FieldErrors {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) fieldErrors[key] = ["unrecognized key"];
      continue;
    }
    const key = issue.path[0];
    if (typeof key === "string") fieldErrors[key] = ["invalid value"];
  }
  return fieldErrors;
}
