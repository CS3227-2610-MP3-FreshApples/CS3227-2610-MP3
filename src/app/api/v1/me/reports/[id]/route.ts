import { authGuards, reportReadService } from "../../../../../../server/composition";
import { errorResponse, parseId, runRoute } from "../../../../../../server/http";
import type { ReportId } from "../../../../../../server/shared";

export const GET = (
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> => runRoute(async (routed, requestId) => {
  if (authGuards === null || reportReadService === null) return errorResponse({ kind: "unavailable" }, requestId);
  const principal = await authGuards.requireActiveUser(routed);
  if (!principal.ok) return errorResponse(principal.error, requestId);
  const reportId = parseId<"ReportId">((await context.params).id);
  if (!reportId.ok) return errorResponse(reportId.error, requestId);
  const result = await reportReadService.get(principal.value.accountId, reportId.value as ReportId);
  return result === null ? errorResponse({ kind: "not_found" }, requestId) : new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
})(request);
