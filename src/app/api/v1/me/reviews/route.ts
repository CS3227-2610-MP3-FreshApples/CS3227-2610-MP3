import { authGuards, reviewReadService } from "../../../../../server/composition";
import { errorResponse, listResponse, readPageRequest, runRoute } from "../../../../../server/http";

export const GET = (request: Request): Promise<Response> => runRoute(async (routed, requestId) => {
  if (authGuards === null || reviewReadService === null) return errorResponse({ kind: "unavailable" }, requestId);
  const principal = await authGuards.requireActiveUser(routed);
  if (!principal.ok) return errorResponse(principal.error, requestId);
  const page = readPageRequest(new URL(routed.url));
  if (!page.ok) return errorResponse(page.error, requestId);
  const result = await reviewReadService.listOwn(principal.value.accountId, page.value.page, page.value.pageSize);
  return listResponse(page.value, result.items, result.total);
})(request);
