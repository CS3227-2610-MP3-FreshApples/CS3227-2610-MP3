import { authService, config, securityLog } from "../../../../../server/composition";
import { errorResponse, runRoute } from "../../../../../server/http";
import { accessDenied, cookie, hosted, response, SESSION_COOKIE } from "../http";

export const GET = runRoute(async (request, id) => {
  if (authService === null || !config.core.valid) return errorResponse({ kind: "unavailable" }, id);
  const token = cookie(request, SESSION_COOKIE, hosted(config.core.value.appEnv));
  const current = token === undefined ? null : await authService.resolveSession(token);
  if (current === null) {
    return errorResponse({ kind: "unauthenticated" }, id);
  }
  if (current.account.status !== "active") {
    accessDenied(securityLog, id, current.account.id);
    return errorResponse({ kind: "forbidden" }, id);
  }
  return response(current.account, 200);
});
