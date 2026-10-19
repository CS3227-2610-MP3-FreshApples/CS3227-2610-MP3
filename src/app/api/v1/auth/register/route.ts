import { config, csrfService, identityService, securityLog } from "../../../../../server/composition";
import { parseRegistrationInput } from "../../../../../server/services/identity";
import { errorResponse, readJsonBody, runRoute } from "../../../../../server/http";
import { csrf, hosted, PRESESSION_COOKIE, cookie, response } from "../http";

export const POST = runRoute(async (request, id) => {
  const body = await readJsonBody(request, parseRegistrationInput);
  if (!body.ok) return errorResponse(body.error, id);
  if (identityService === null || csrfService === null || !config.core.valid) return errorResponse({ kind: "unavailable" }, id);
  const pre = cookie(request, PRESESSION_COOKIE, hosted(config.core.value.appEnv));
  const subject = pre !== undefined && csrfService.verifyPreSession(pre) ? pre : undefined;
  if (!csrf(request, subject, csrfService, securityLog, id, config.core.value.publicAppUrl)) {
    return errorResponse({ kind: "csrf_failed" }, id);
  }
  const result = await identityService.register(body.value);
  if (!result.ok) return errorResponse(result.error, id);
  return response(result.value, 201, { "set-cookie": csrfService.clearPreSessionCookie({ hosted: hosted(config.core.value.appEnv) }) });
});
