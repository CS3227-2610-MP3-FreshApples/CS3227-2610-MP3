import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));

import type { Database } from "../../../src/server/db";
import type { SessionRecord, SessionRepository } from "../../../src/server/repositories/identity";
import type { AccountId, SessionId, Tx } from "../../../src/server/shared";
import {
  createSessionService,
  hashSessionToken,
} from "../../../src/server/services/identity/session";
import {
  createCsrfService,
  readCookie,
  serializeCookie,
} from "../../../src/server/services/identity/csrf";

const tx = {} as Tx;
const accountId = "00000000-0000-4000-8000-000000000001" as AccountId;
const sessionId = "00000000-0000-4000-8000-000000000002" as SessionId;
const NOW = new Date("2026-10-17T00:00:00.000Z");
const CSRF_SECRET = "synthetic-session-secret-0123456789abcdef";

function hmac(...parts: string[]): string {
  return createHmac("sha256", CSRF_SECRET).update(parts.join("|"), "utf8").digest("base64url");
}

function database(): Database {
  return {
    withTransaction: async (work) => work(tx),
    withTransactionResult: async (work) => work(tx),
    probe: async () => undefined,
  };
}

function repository(): SessionRepository & { rows: Map<string, SessionRecord>; deleted: string[] } {
  const rows = new Map<string, SessionRecord>();
  const deleted: string[] = [];
  return {
    rows,
    deleted,
    create: async (_transaction, input) => {
      const record = { ...input, id: sessionId };
      rows.set(input.hashedToken.toString("hex"), record);
      return record;
    },
    findByHashedToken: async (_transaction, hashedToken) => rows.get(hashedToken.toString("hex")) ?? null,
    deleteById: async (_transaction, id) => {
      deleted.push(id);
    },
    deleteByAccountId: async (_transaction, id) => {
      deleted.push(id);
    },
  };
}

describe("opaque sessions", () => {
  it("generates a token, persists only its hash, and rejects expiry", async () => {
    const repo = repository();
    const service = createSessionService({ database: database(), sessionRepository: repo, sessionTtlSeconds: 8 * 60 * 60 });

    const created = await service.create(accountId, NOW);

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repo.rows.has(created.token)).toBe(false);
    expect(repo.rows.has(hashSessionToken(created.token).toString("hex"))).toBe(true);
    await expect(service.resolve(created.token, new Date("2026-10-17T07:59:59.999Z"))).resolves.toMatchObject({ id: sessionId });
    await expect(service.resolve(created.token, new Date("2026-10-17T08:00:00.000Z"))).resolves.toBeNull();
  });

  it("supports logout, account revocation, and fresh login rotation", async () => {
    const repo = repository();
    const service = createSessionService({ database: database(), sessionRepository: repo, sessionTtlSeconds: 8 * 60 * 60 });
    const first = await service.create(accountId, NOW);
    const second = await service.create(accountId, NOW);

    expect(second.token).not.toBe(first.token);
    await service.logout(sessionId);
    await service.revokeAccount(accountId);
    expect(repo.deleted).toEqual([sessionId, accountId]);
  });

  it("uses the configured session TTL", async () => {
    const repo = repository();
    const service = createSessionService({ database: database(), sessionRepository: repo, sessionTtlSeconds: 1_800 });

    const created = await service.create(accountId, NOW);

    expect(created.session.expiresAt).toEqual(new Date("2026-10-17T00:30:00.000Z"));
  });
});

describe("D-14 CSRF wire service", () => {
  const service = createCsrfService({ secret: CSRF_SECRET });

  it("binds an expiring token to a pre-session and rotates invalid bindings", () => {
    const preSession = service.issuePreSession(NOW);
    const token = service.issueToken(preSession.value, NOW);

    expect(preSession.value).toMatch(/^pre_v1\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(preSession.expiresAt).toEqual(new Date("2026-10-17T00:30:00.000Z"));
    expect(token).toMatch(/^csrf_v1\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(service.verifyPreSession(preSession.value, NOW)).toBe(true);
    expect(service.verifyToken(token, preSession.value, NOW)).toBe(true);
    expect(service.verifyToken(token, "pre_v1.other", NOW)).toBe(false);
    expect(service.verifyToken(token, preSession.value, new Date("2026-10-17T08:00:00.001Z"))).toBe(false);
    expect(service.verifyToken(`${token}x`, preSession.value, NOW)).toBe(false);
    expect(service.verifyToken(`${token}=`, preSession.value, NOW)).toBe(false);
    expect(service.verifyPreSession("not-a-pre-session", NOW)).toBe(false);
    expect(service.verifyPreSession(preSession.value, new Date("2026-10-17T00:30:00.001Z"))).toBe(false);
    expect(service.issuePreSession(NOW).value).not.toBe(preSession.value);
    expect(service.clearPreSessionCookie({ hosted: true })).toContain("Max-Age=0");
  });

  it("requires the exact application Origin and serializes hosted cookies safely", () => {
    expect(service.verifyOrigin("https://app.example.test", "https://app.example.test")).toBe(true);
    expect(service.verifyOrigin("https://app.example.test.evil", "https://app.example.test")).toBe(false);
    expect(service.verifyOrigin(undefined, "https://app.example.test")).toBe(false);

    const cookie = serializeCookie("fa_session", "opaque-token", { hosted: true });
    expect(cookie).toBe("__Host-fa_session=opaque-token; HttpOnly; Secure; SameSite=Lax; Path=/");
    expect(service.serializePreSessionCookie("pre_v1.binding", { hosted: true, maxAge: 1800 })).toBe(
      "__Host-fa_presession=pre_v1.binding; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1800",
    );
  });

  it("rejects correctly signed nonce values outside unpadded base64url grammar", () => {
    const issuedAt = "1792195200";
    const invalidNonce = "nonce/with+standard=base64";
    const subject = "pre_v1.synthetic-binding";
    const csrfSignature = hmac("csrf_v1", subject, issuedAt, invalidNonce);
    const preSessionSignature = hmac("pre_v1", issuedAt, invalidNonce);

    expect(service.verifyToken(`csrf_v1.${issuedAt}.${invalidNonce}.${csrfSignature}`, subject, NOW)).toBe(false);
    expect(service.verifyPreSession(`pre_v1.${issuedAt}.${invalidNonce}.${preSessionSignature}`, NOW)).toBe(false);
  });

  it("resolves the same cookie name used on the wire", () => {
    const hostedRequest = new Request("https://app.example.test", { headers: { cookie: "__Host-fa_session=hosted-token; fa_session=local-token" } });
    const localRequest = new Request("http://localhost:3000", { headers: { cookie: "fa_session=local-token" } });

    expect(readCookie(hostedRequest, "fa_session", true)).toBe("hosted-token");
    expect(readCookie(hostedRequest, "fa_session", false)).toBe("local-token");
    expect(readCookie(localRequest, "fa_session", true)).toBeUndefined();
  });
});
