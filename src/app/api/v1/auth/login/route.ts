import { authService, clientIpResolver, config, csrfService, securityLog } from "../../../../../server/composition";
import { parseLoginInput } from "../../../../../server/services/identity";
import { errorResponse, readJsonBody, runRoute } from "../../../../../server/http";
import { cookie, csrf, hosted, PRESESSION_COOKIE, response } from "../http";

export const POST = runRoute(async (request, id) => {
  const body = await readJsonBody(request, parseLoginInput);
  if (!body.ok) return errorResponse(body.error, id);
  if (authService === null || csrfService === null || !config.core.valid) return errorResponse({ kind: "unavailable" }, id);
  const pre = cookie(request, PRESESSION_COOKIE, hosted(config.core.value.appEnv));
  const subject = pre !== undefined && csrfService.verifyPreSession(pre) ? pre : undefined;
  if (!csrf(request, subject, csrfService, securityLog, id, config.core.value.publicAppUrl)) return errorResponse({ kind: "csrf_failed" }, id);
  const result = await authService.login(body.value, clientIpResolver(request.headers), id);
  if (!result.ok) return errorResponse(result.error, id);
  const cookieValue = csrfService.serializeSessionCookie(result.value.session.token, { hosted: hosted(config.core.value.appEnv) });
  return response({ id: result.value.id, displayName: result.value.displayName, role: result.value.role, status: result.value.status, version: result.value.version }, 200, [
    ["set-cookie", cookieValue],
    ["set-cookie", csrfService.clearPreSessionCookie({ hosted: hosted(config.core.value.appEnv) })],
  ]);
});
