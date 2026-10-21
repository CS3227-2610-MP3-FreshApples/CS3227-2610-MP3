import { adminReviewService, authGuards } from "../../../../../server/composition";
import { errorResponse, listResponse, readPageRequest, runRoute } from "../../../../../server/http";
import { parseAdminReviewFilters } from "../../../../../server/services/moderation/admin-review-input";

export const GET = runRoute(async (request, requestId) => {
  if (authGuards === null || adminReviewService === null) return errorResponse({ kind: "unavailable" }, requestId);
  const principal = await authGuards.requireActiveAdmin(request);
  if (!principal.ok) return errorResponse(principal.error, requestId);
  const url = new URL(request.url);
  const page = readPageRequest(url);
  if (!page.ok) return errorResponse(page.error, requestId);
  const filters = parseAdminReviewFilters(url.searchParams);
  if (!filters.ok) return errorResponse({ kind: "invalid_fields", fieldErrors: filters.error }, requestId);
  const result = await adminReviewService.list(principal.value, filters.value, page.value.page, page.value.pageSize);
  return result.ok ? listResponse(page.value, result.value.items, result.value.total) : errorResponse(result.error, requestId);
});
