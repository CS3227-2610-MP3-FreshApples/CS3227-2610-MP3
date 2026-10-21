import { authGuards, reportService } from "../../../../server/composition";
import { errorResponse, readJsonBody, runRoute } from "../../../../server/http";
import { parseReportSubmissionInput } from "../../../../server/services/moderation";

export const POST = (request: Request): Promise<Response> => runRoute(async (routed, requestId) => {
  if (authGuards === null || reportService === null) return errorResponse({ kind: "unavailable" }, requestId);
  const principal = await authGuards.requireActiveUserMutation(routed);
  if (!principal.ok) return errorResponse(principal.error, requestId);
  const body = await readJsonBody(routed, parseReportSubmissionInput);
  if (!body.ok) return errorResponse(body.error, requestId);
  const result = await reportService.submit(principal.value.accountId, body.value.reviewId, {
    category: body.value.category,
    explanation: body.value.explanation,
  });
  if (!result.ok) return errorResponse(result.error, requestId);
  return new Response(JSON.stringify(result.value), { status: 201, headers: { "Content-Type": "application/json; charset=utf-8" } });
})(request);
