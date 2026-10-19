import type { CsrfService } from "../../../../server/services/identity";
import { readCookie } from "../../../../server/services/identity";
import type { SecurityLog } from "../../../../server/services/audit";
import type { AccountId, RequestId } from "../../../../server/shared";

export const SESSION_COOKIE = "fa_session";
export const PRESESSION_COOKIE = "fa_presession";

export function cookie(request: Request, name: "fa_session" | "fa_presession", hostedMode: boolean): string | undefined {
  return readCookie(request, name, hostedMode);
}

export function csrf(request: Request, subject: string | undefined, csrfService: CsrfService, securityLog: SecurityLog, id: RequestId, publicAppUrl: string): boolean {
  const valid = subject !== undefined
    && csrfService.verifyOrigin(request.headers.get("origin") ?? undefined, publicAppUrl)
    && csrfService.verifyToken(request.headers.get("x-csrf-token") ?? "", subject);
  if (!valid) securityLog.record({ event: "auth.csrf_failed", requestId: id, code: "csrf_failed" });
  return valid;
}

export function accessDenied(securityLog: SecurityLog, id: RequestId, actorId: AccountId): void {
  securityLog.record({ event: "access.denied", requestId: id, code: "forbidden", actorId });
}

export function response(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (headers instanceof Headers) headers.forEach((value, key) => responseHeaders.append(key, value));
  else if (Array.isArray(headers)) headers.forEach(([key, value]) => responseHeaders.append(key, value));
  else if (headers !== undefined) Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, String(value)));
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: responseHeaders });
}

export function hosted(appEnv: string): boolean { return appEnv === "development" || appEnv === "production"; }
