import { adminUserService, authGuards } from "../../../../../../server/composition";
import { errorResponse, parseId, runRoute, versionedJsonResponse } from "../../../../../../server/http";
import type { AccountId } from "../../../../../../server/shared";

interface UserRouteContext { readonly params: Promise<{ readonly id: string }> }

export function GET(request: Request, context: UserRouteContext): Promise<Response> {
  return runRoute(async (routed, requestId) => {
    if (authGuards === null || adminUserService === null) return errorResponse({ kind: "unavailable" }, requestId);
    const principal = await authGuards.requireActiveAdmin(routed);
    if (!principal.ok) return errorResponse(principal.error, requestId);
    const accountId = parseId<"AccountId">((await context.params).id);
    if (!accountId.ok) return errorResponse(accountId.error, requestId);
    const result = await adminUserService.get(principal.value, accountId.value as AccountId);
    return result.ok ? versionedJsonResponse(200, result.value, result.value.version) : errorResponse(result.error, requestId);
  })(request);
}
