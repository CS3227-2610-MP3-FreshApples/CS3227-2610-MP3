import { adminReviewService, authGuards } from "../../../../../../server/composition";
import { errorResponse, parseId, runRoute, versionedJsonResponse } from "../../../../../../server/http";
import type { ReviewRouteContext } from "../http";

export function GET(request: Request, context: ReviewRouteContext): Promise<Response> {
  return runRoute(async (routed, requestId) => {
    if (authGuards === null || adminReviewService === null) return errorResponse({ kind: "unavailable" }, requestId);
    const principal = await authGuards.requireActiveAdmin(routed);
    if (!principal.ok) return errorResponse(principal.error, requestId);
    const reviewId = parseId<"ReviewId">((await context.params).id);
    if (!reviewId.ok) return errorResponse(reviewId.error, requestId);
    const result = await adminReviewService.get(principal.value, reviewId.value);
    return result.ok ? versionedJsonResponse(200, result.value, result.value.version) : errorResponse(result.error, requestId);
  })(request);
}
