import { authService, config, csrfService } from "../../../../../server/composition";
import { errorResponse, runRoute } from "../../../../../server/http";
import { cookie, hosted, PRESESSION_COOKIE, response, SESSION_COOKIE } from "../http";

export const GET = runRoute(async (request, id) => {
  if (csrfService === null || !config.core.valid) return errorResponse({ kind: "unavailable" }, id);
  const hostedMode = hosted(config.core.value.appEnv);
  const sessionToken = cookie(request, SESSION_COOKIE, hostedMode);
  const current = sessionToken === undefined || authService === null ? null : await authService.resolveSession(sessionToken);
  let subject: string;
  let setCookie: string | undefined;
  if (current !== null) {
    subject = current.sessionId;
  } else {
    const pre = cookie(request, PRESESSION_COOKIE, hostedMode);
    const binding = pre !== undefined && csrfService.verifyPreSession(pre) ? { value: pre } : csrfService.issuePreSession();
    subject = binding.value;
    if (pre !== binding.value) setCookie = csrfService.serializePreSessionCookie(binding.value, { hosted: hostedMode, maxAge: 1800 });
  }
  return response({ csrfToken: csrfService.issueToken(subject) }, 200, setCookie === undefined ? undefined : { "set-cookie": setCookie });
});
