import { adminUserService, authGuards } from "../../../../../../../server/composition";
import { errorResponse, parseId, readIfMatch, readJsonBody, runRoute, versionedJsonResponse } from "../../../../../../../server/http";
import { parseAdminUserStatusInput } from "../../../../../../../server/services/identity";
import type { AccountId } from "../../../../../../../server/shared";

interface UserStatusRouteContext { readonly params: Promise<{ readonly id: string }> }

export function PATCH(request: Request, context: UserStatusRouteContext): Promise<Response> {
  return runRoute(async (routed, requestId) => {
    if (authGuards === null || adminUserService === null) return errorResponse({ kind: "unavailable" }, requestId);
    const principal = await authGuards.requireActiveAdminMutation(routed);
    if (!principal.ok) return errorResponse(principal.error, requestId);
    const accountId = parseId<"AccountId">((await context.params).id);
    if (!accountId.ok) return errorResponse(accountId.error, requestId);
    const expected = readIfMatch(routed);
    if (!expected.ok) return errorResponse(expected.error, requestId);
    const input = await readJsonBody(routed, parseAdminUserStatusInput);
    if (!input.ok) return errorResponse(input.error, requestId);
    const result = await adminUserService.updateStatus(principal.value, accountId.value as AccountId, expected.value, input.value, requestId);
    return result.ok ? versionedJsonResponse(200, result.value, result.value.version) : errorResponse(result.error, requestId);
  })(request);
}
