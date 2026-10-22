import { adminUserService, authGuards } from "../../../../../server/composition";
import { errorResponse, listResponse, readPageRequest, runRoute } from "../../../../../server/http";
import { parseAdminUserFilters } from "../../../../../server/services/identity";

/** GET /api/v1/admin/users: USER accounts only, displayName ASC and id ASC. */
export const GET = runRoute(async (request, requestId) => {
  if (authGuards === null || adminUserService === null) return errorResponse({ kind: "unavailable" }, requestId);
  const principal = await authGuards.requireActiveAdmin(request);
  if (!principal.ok) return errorResponse(principal.error, requestId);
  const url = new URL(request.url);
  const page = readPageRequest(url);
  if (!page.ok) return errorResponse(page.error, requestId);
  const filters = parseAdminUserFilters(url.searchParams);
  if (!filters.ok) return errorResponse({ kind: "invalid_fields", fieldErrors: filters.error }, requestId);
  const result = await adminUserService.list(principal.value, filters.value, page.value.page, page.value.pageSize);
  return result.ok ? listResponse(page.value, result.value.items, result.value.total) : errorResponse(result.error, requestId);
});
