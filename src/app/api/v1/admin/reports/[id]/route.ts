import { adminReportService, authGuards } from "../../../../../../server/composition";
import { errorResponse, parseId, runRoute, versionedJsonResponse } from "../../../../../../server/http";

export interface ReportRouteContext { readonly params: Promise<{ readonly id: string }> }

export function GET(request: Request, context: ReportRouteContext): Promise<Response> {
  return runRoute(async (routed, requestId) => {
    if (authGuards === null || adminReportService === null) return errorResponse({ kind: "unavailable" }, requestId);
    const principal = await authGuards.requireActiveAdmin(routed);
    if (!principal.ok) return errorResponse(principal.error, requestId);
    const reportId = parseId<"ReportId">((await context.params).id);
    if (!reportId.ok) return errorResponse(reportId.error, requestId);
    const result = await adminReportService.get(principal.value, reportId.value);
    return result.ok ? versionedJsonResponse(200, result.value, result.value.version) : errorResponse(result.error, requestId);
  })(request);
}
