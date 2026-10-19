import "server-only";

import type { Database } from "../../db";
import type { AccountRepository } from "../../repositories/identity";
import type { RateLimitKeys, RateLimiter } from "../rate-limit";
import { RATE_LIMIT_POLICIES } from "../rate-limit";
import type { SecurityLog } from "../audit";
import { ServiceUnavailableError, TransactionConflict, type DomainError, type FieldErrors, type RequestId, type Result } from "../../shared";
import { normalizeEmail, safeAccountProjection, verifyPassword, type SafeAccount } from "./account";
import type { SessionService, CreatedSession } from "./session";

const DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$fw0Qs5CeKOK4H90Whzdhmw$n+M+gfiQWB28igBCBqE3hHiQz6PEZUHXJWoeTwDj0DE";

export interface AuthService {
  login(input: unknown, clientIp: string, requestId: RequestId): Promise<Result<SafeAccount & { readonly session: CreatedSession }, DomainError>>;
  resolveSession(token: string): Promise<{ readonly account: SafeAccount; readonly sessionId: string } | null>;
  logout(sessionId: string): Promise<void>;
}

export interface AuthServiceDependencies {
  readonly database: Database;
  readonly accountRepository: Pick<AccountRepository, "findByNormalizedEmail" | "findById">;
  readonly sessions: SessionService;
  readonly rateLimiter: RateLimiter;
  readonly rateLimitKeys: RateLimitKeys;
  readonly securityLog: SecurityLog;
}

export function parseLoginInput(input: unknown): Result<{ readonly email: string; readonly password: string }, FieldErrors> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: { email: ["invalid value"], password: ["invalid value"] } };
  }
  const value = input as Record<string, unknown>;
  const fieldErrors: Record<string, string[]> = {};
  for (const key of Object.keys(value)) {
    if (key !== "email" && key !== "password") fieldErrors[key] = ["unrecognized key"];
  }
  if (typeof value.email !== "string") fieldErrors.email = ["invalid value"];
  if (typeof value.password !== "string") fieldErrors.password = ["invalid value"];
  if (Object.keys(fieldErrors).length > 0) return { ok: false, error: fieldErrors };
  return { ok: true, value: { email: value.email as string, password: value.password as string } };
}

export function createAuthService(deps: AuthServiceDependencies): AuthService {
  return {
    async login(input, clientIp, requestId) {
      const parsedResult = parseLoginInput(input);
      if (!parsedResult.ok) return { ok: false, error: { kind: "invalid_fields", fieldErrors: parsedResult.error } };
      const parsed = parsedResult.value;

      const normalizedEmail = normalizeEmail(parsed.email);
      if (normalizedEmail === null) return { ok: false, error: { kind: "invalid_fields", fieldErrors: { email: ["invalid email"] } } };
      const emailKey = deps.rateLimitKeys.forEmail("login_failure_email", normalizedEmail);
      const ipKey = deps.rateLimitKeys.forClientIp("login_failure_ip", clientIp);
      const [emailCheck, ipCheck] = await dependencyCall(() => Promise.all([
        deps.rateLimiter.check(emailKey, RATE_LIMIT_POLICIES.login_failure_email),
        deps.rateLimiter.check(ipKey, RATE_LIMIT_POLICIES.login_failure_ip),
      ]));
      if (!emailCheck.allowed || !ipCheck.allowed) {
        const retryAfterSeconds = Math.max(
          emailCheck.allowed ? 0 : emailCheck.retryAfterSeconds,
          ipCheck.allowed ? 0 : ipCheck.retryAfterSeconds,
        );
        const limit = emailCheck.allowed ? "login_failure_ip" : "login_failure_email";
        deps.securityLog.record({ event: "rate_limit.rejected", requestId, limit });
        deps.securityLog.record({ event: "auth.login_throttled", requestId, limit });
        return { ok: false, error: { kind: "rate_limited", retryAfterSeconds } };
      }

      const account = await dependencyCall(() => deps.database.withTransaction((tx) => deps.accountRepository.findByNormalizedEmail(tx, normalizedEmail)));
      const passwordHash = account?.passwordHash ?? DUMMY_PASSWORD_HASH;
      const passwordMatches = await verifyPassword(passwordHash, parsed.password);
      if (!passwordMatches || account?.status !== "active") {
        await dependencyCall(() => Promise.all([
          deps.rateLimiter.consume(emailKey, RATE_LIMIT_POLICIES.login_failure_email, 1),
          deps.rateLimiter.consume(ipKey, RATE_LIMIT_POLICIES.login_failure_ip, 1),
        ]));
        deps.securityLog.record({ event: "auth.login_failed", requestId, ...(account ? { actorId: account.id } : {}) });
        return { ok: false, error: { kind: "unauthenticated" } };
      }

      const session = await dependencyCall(() => deps.sessions.create(account.id));
      return { ok: true, value: { ...safeAccountProjection(account), session } };
    },
    async resolveSession(token) {
      const session = await dependencyCall(() => deps.sessions.resolve(token));
      if (session === null) return null;
      const account = await dependencyCall(() => deps.database.withTransaction((tx) => deps.accountRepository.findById(tx, session.accountId)));
      return account === null ? null : { account: safeAccountProjection(account), sessionId: session.id };
    },
    logout: (sessionId) => dependencyCall(() => deps.sessions.logout(sessionId as never)),
  };
}

async function dependencyCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TransactionConflict || error instanceof ServiceUnavailableError) throw error;
    throw new ServiceUnavailableError();
  }
}
