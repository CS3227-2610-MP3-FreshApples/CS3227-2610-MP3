import { authService, config, csrfService, securityLog } from "../../../../../server/composition";
import { errorResponse, runRoute } from "../../../../../server/http";
import { cookie, csrf, hosted, response, SESSION_COOKIE } from "../http";

export const POST = runRoute(async (request, id) => {
  if (authService === null || csrfService === null || !config.core.valid) return errorResponse({ kind: "unavailable" }, id);
  const sessionToken = cookie(request, SESSION_COOKIE, hosted(config.core.value.appEnv));
  if (sessionToken === undefined) {
    return errorResponse({ kind: "unauthenticated" }, id);
  }
  const current = await authService.resolveSession(sessionToken);
  if (current === null) {
    return errorResponse({ kind: "unauthenticated" }, id);
  }
  if (!csrf(request, current.sessionId, csrfService, securityLog, id, config.core.value.publicAppUrl)) return errorResponse({ kind: "csrf_failed" }, id);
  await authService.logout(current.sessionId);
  return response(undefined, 204, { "set-cookie": csrfService.clearSessionCookie({ hosted: hosted(config.core.value.appEnv) }) });
});
