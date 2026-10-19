import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { Database } from "../../db";
import type { AccountId, SessionId } from "../../shared";
import type { SessionRecord, SessionRepository } from "../../repositories/identity";

export interface CreatedSession {
  readonly token: string;
  readonly session: SessionRecord;
}

export interface SessionService {
  create(accountId: AccountId, now?: Date): Promise<CreatedSession>;
  resolve(token: string, now?: Date): Promise<SessionRecord | null>;
  logout(sessionId: SessionId): Promise<void>;
  revokeAccount(accountId: AccountId): Promise<void>;
}

export interface SessionServiceDependencies {
  readonly database: Database;
  readonly sessionRepository: SessionRepository;
  readonly sessionTtlSeconds: number;
  readonly randomBytes?: (size: number) => Buffer;
}

export function generateSessionToken(random: (size: number) => Buffer = randomBytes): string {
  return random(32).toString("base64url");
}

export function hashSessionToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function createSessionService({ database, sessionRepository, sessionTtlSeconds, randomBytes: random = randomBytes }: SessionServiceDependencies): SessionService {
  return {
    async create(accountId, now = new Date()) {
      const token = generateSessionToken(random);
      const session = await database.withTransaction((tx) =>
        sessionRepository.create(tx, {
          hashedToken: hashSessionToken(token),
          accountId,
          expiresAt: new Date(now.getTime() + sessionTtlSeconds * 1000),
        }),
      );
      return { token, session };
    },
    async resolve(token, now = new Date()) {
      if (!isPlausibleToken(token)) return null;
      return database.withTransaction(async (tx) => {
        const session = await sessionRepository.findByHashedToken(tx, hashSessionToken(token));
        if (session === null) return null;
        if (session.expiresAt.getTime() <= now.getTime()) {
          await sessionRepository.deleteById(tx, session.id);
          return null;
        }
        return session;
      });
    },
    async logout(sessionId) {
      await database.withTransaction((tx) => sessionRepository.deleteById(tx, sessionId));
    },
    async revokeAccount(accountId) {
      await database.withTransaction((tx) => sessionRepository.deleteByAccountId(tx, accountId));
    },
  };
}

function isPlausibleToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
