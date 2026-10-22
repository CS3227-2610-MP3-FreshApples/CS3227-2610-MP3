import { adminReportService, authGuards } from "../../../../../server/composition";
import { errorResponse, listResponse, readPageRequest, runRoute } from "../../../../../server/http";
import { parseAdminReportFilters } from "../../../../../server/services/moderation";

export const GET = runRoute(async (request, requestId) => {
  if (authGuards === null || adminReportService === null) return errorResponse({ kind: "unavailable" }, requestId);
  const principal = await authGuards.requireActiveAdmin(request);
  if (!principal.ok) return errorResponse(principal.error, requestId);
  const page = readPageRequest(new URL(request.url));
  if (!page.ok) return errorResponse(page.error, requestId);
  const filters = parseAdminReportFilters(new URL(request.url).searchParams);
  if (!filters.ok) return errorResponse({ kind: "invalid_fields", fieldErrors: filters.error }, requestId);
  const result = await adminReportService.list(principal.value, filters.value, page.value.page, page.value.pageSize);
  return result.ok ? listResponse(page.value, result.value.items, result.value.total) : errorResponse(result.error, requestId);
});
