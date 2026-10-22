import { adminReportService, authGuards } from "../../../../../../../server/composition";
import { errorResponse, parseId, readIfMatch, readJsonBody, runRoute, versionedJsonResponse } from "../../../../../../../server/http";
import { parseAdminReportDecisionInput } from "../../../../../../../server/services/moderation/admin-report-decision-input";

export const POST = (
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> => runRoute(async (routed, requestId) => {
  if (authGuards === null || adminReportService === null) return errorResponse({ kind: "unavailable" }, requestId);
  const principal = await authGuards.requireActiveAdminMutation(routed);
  if (!principal.ok) return errorResponse(principal.error, requestId);
  const reportId = parseId<"ReportId">((await context.params).id);
  if (!reportId.ok) return errorResponse(reportId.error, requestId);
  const expected = readIfMatch(routed);
  if (!expected.ok) return errorResponse(expected.error, requestId);
  const body = await readJsonBody(routed, parseAdminReportDecisionInput);
  if (!body.ok) return errorResponse(body.error, requestId);
  const result = await adminReportService.decide(principal.value, reportId.value, expected.value, body.value, requestId);
  if (!result.ok) return errorResponse(result.error, requestId);
  return versionedJsonResponse(200, result.value, result.value.version);
})(request);
