import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { readCookie, type CsrfService } from "./csrf";
import type { AuthService } from "./auth";
import type { SecurityLog } from "../audit";
import type { AccountId, AccountRole, RequestId, Result, SessionId } from "../../shared";

const SESSION_COOKIE = "fa_session";
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface Principal {
  readonly accountId: AccountId;
  readonly sessionId: SessionId;
  readonly role: AccountRole;
}

export type AuthFailure = { readonly kind: "unauthenticated" } | { readonly kind: "forbidden" } | { readonly kind: "csrf_failed" };

export interface AuthGuards {
  requireActiveUser(request: Request): Promise<Result<Principal, AuthFailure>>;
  requireActiveAdmin(request: Request): Promise<Result<Principal, AuthFailure>>;
  requireActiveUserMutation(request: Request): Promise<Result<Principal, AuthFailure>>;
  requireActiveAdminMutation(request: Request): Promise<Result<Principal, AuthFailure>>;
  requireCronCaller(request: Request): Result<void, { readonly kind: "unauthenticated" }>;
}

export function createAuthGuards(deps: {
  readonly authService: Pick<AuthService, "resolveSession">;
  readonly csrfService: Pick<CsrfService, "verifyOrigin" | "verifyToken">;
  readonly securityLog: SecurityLog;
  readonly cronSecret: string;
  readonly publicAppUrl: string;
  readonly hosted: boolean;
}): AuthGuards {
  const requestId = (request: Request): RequestId => {
    const routedId = request.headers.get("x-request-id");
    return routedId !== null && REQUEST_ID_PATTERN.test(routedId) ? routedId as RequestId : randomUUID() as RequestId;
  };
  const denied = (request: Request, actorId: AccountId): void => {
    deps.securityLog.record({ event: "access.denied", requestId: requestId(request), code: "forbidden", actorId });
  };
  const authenticate = async (request: Request, role: AccountRole | null, mutation: boolean): Promise<Result<Principal, AuthFailure>> => {
    const token = readCookie(request, SESSION_COOKIE, deps.hosted);
    if (token === undefined) {
      return { ok: false, error: { kind: "unauthenticated" } };
    }
    const resolved = await deps.authService.resolveSession(token);
    if (resolved === null) {
      return { ok: false, error: { kind: "unauthenticated" } };
    }
    if (resolved.account.status !== "active" || (role !== null && resolved.account.role !== role)) {
      denied(request, resolved.account.id);
      return { ok: false, error: { kind: "forbidden" } };
    }
    const principal = { accountId: resolved.account.id, sessionId: resolved.sessionId as SessionId, role: resolved.account.role };
    if (mutation && (!deps.csrfService.verifyOrigin(request.headers.get("origin") ?? undefined, deps.publicAppUrl)
      || !deps.csrfService.verifyToken(request.headers.get("x-csrf-token") ?? "", principal.sessionId))) {
      deps.securityLog.record({ event: "auth.csrf_failed", requestId: requestId(request), actorId: principal.accountId, code: "csrf_failed" });
      return { ok: false, error: { kind: "csrf_failed" } };
    }
    return { ok: true, value: principal };
  };
  return {
    requireActiveUser: (request) => authenticate(request, "USER", false),
    requireActiveAdmin: (request) => authenticate(request, "ADMIN", false),
    requireActiveUserMutation: (request) => authenticate(request, "USER", true),
    requireActiveAdminMutation: (request) => authenticate(request, "ADMIN", true),
    requireCronCaller(request) {
      const authorization = request.headers.get("authorization");
      const prefix = "Bearer ";
      const credential = authorization !== null && authorization.startsWith(prefix) ? authorization.slice(prefix.length) : null;
      const actual = credential === null ? Buffer.alloc(0) : Buffer.from(credential);
      const expected = Buffer.from(deps.cronSecret);
      const valid = actual.length === expected.length && timingSafeEqual(actual, expected);
      if (!valid) {
        return { ok: false, error: { kind: "unauthenticated" } };
      }
      return { ok: true, value: undefined };
    },
  };
}
