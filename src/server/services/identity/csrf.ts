import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const CSRF_VERSION = "csrf_v1";
const PRE_SESSION_VERSION = "pre_v1";
const CSRF_TTL_SECONDS = 8 * 60 * 60;
const PRE_SESSION_TTL_SECONDS = 30 * 60;
const UNPADDED_BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface CookieOptions {
  readonly hosted: boolean;
  readonly maxAge?: number;
}

export interface PreSession {
  readonly value: string;
  readonly expiresAt: Date;
}

export type AuthCookieName = "fa_session" | "fa_presession";

export interface CsrfService {
  issuePreSession(now?: Date): PreSession;
  issueToken(subject: string, now?: Date): string;
  verifyToken(token: string, subject: string, now?: Date): boolean;
  verifyPreSession(value: string, now?: Date): boolean;
  verifyOrigin(origin: string | undefined, publicAppUrl: string): boolean;
  clearPreSessionCookie(options: CookieOptions): string;
  clearSessionCookie(options: CookieOptions): string;
  serializeSessionCookie(value: string, options: CookieOptions): string;
  serializePreSessionCookie(value: string, options: CookieOptions): string;
}

export function resolveCookieName(name: AuthCookieName, hosted: boolean): string {
  return hosted ? `__Host-${name}` : name;
}

export function readCookie(request: Request, name: AuthCookieName, hosted: boolean): string | undefined {
  const wireName = resolveCookieName(name, hosted);
  const value = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${wireName}=`));
  return value?.slice(wireName.length + 1);
}

export function serializeCookie(name: AuthCookieName, value: string, options: CookieOptions): string {
  const cookieName = resolveCookieName(name, options.hosted);
  const attributes = ["HttpOnly", ...(options.hosted ? ["Secure"] : []), "SameSite=Lax", "Path=/"];
  if (options.maxAge !== undefined) attributes.push(`Max-Age=${options.maxAge}`);
  return `${cookieName}=${value}; ${attributes.join("; ")}`;
}

export function createCsrfService({ secret, random = randomBytes }: { readonly secret: string; readonly random?: (size: number) => Buffer }): CsrfService {
  return {
    issuePreSession(now = new Date()) {
      const issuedAt = seconds(now);
      const nonce = random(32).toString("base64url");
      const signature = sign(secret, PRE_SESSION_VERSION, String(issuedAt), nonce);
      return {
        value: `${PRE_SESSION_VERSION}.${issuedAt}.${nonce}.${signature}`,
        expiresAt: new Date(now.getTime() + PRE_SESSION_TTL_SECONDS * 1000),
      };
    },
    issueToken(subject, now = new Date()) {
      const issuedAt = seconds(now);
      const nonce = random(32).toString("base64url");
      const signature = sign(secret, CSRF_VERSION, subject, String(issuedAt), nonce);
      return `${CSRF_VERSION}.${issuedAt}.${nonce}.${signature}`;
    },
    verifyToken(token, subject, now = new Date()) {
      const parts = token.split(".");
      if (parts.length !== 4 || parts[0] !== CSRF_VERSION || !isUnpaddedBase64Url(parts[2]) || !isUnpaddedBase64Url(parts[3])) return false;
      const issuedAt = parseIssuedAt(parts[1]);
      if (issuedAt === null || seconds(now) - issuedAt < 0 || seconds(now) - issuedAt >= CSRF_TTL_SECONDS) return false;
      return equal(parts[3], sign(secret, CSRF_VERSION, subject, parts[1], parts[2]));
    },
    verifyPreSession(value, now = new Date()) {
      const parts = value.split(".");
      if (parts.length !== 4 || parts[0] !== PRE_SESSION_VERSION || !isUnpaddedBase64Url(parts[2]) || !isUnpaddedBase64Url(parts[3])) return false;
      const issuedAt = parseIssuedAt(parts[1]);
      if (issuedAt === null || seconds(now) - issuedAt < 0 || seconds(now) - issuedAt >= PRE_SESSION_TTL_SECONDS) return false;
      return equal(parts[3], sign(secret, PRE_SESSION_VERSION, parts[1], parts[2]));
    },
    verifyOrigin(origin, publicAppUrl) {
      return origin === publicAppUrl;
    },
    clearPreSessionCookie(options) {
      return serializeCookie("fa_presession", "", { ...options, maxAge: 0 });
    },
    clearSessionCookie(options) {
      return serializeCookie("fa_session", "", { ...options, maxAge: 0 });
    },
    serializeSessionCookie(value, options) {
      return serializeCookie("fa_session", value, options);
    },
    serializePreSessionCookie(value, options) {
      return serializeCookie("fa_presession", value, options);
    },
  };
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function parseIssuedAt(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isUnpaddedBase64Url(value: string): boolean {
  return UNPADDED_BASE64URL.test(value);
}

function sign(secret: string, ...parts: string[]): string {
  return createHmac("sha256", secret).update(parts.join("|"), "utf8").digest("base64url");
}

function equal(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
