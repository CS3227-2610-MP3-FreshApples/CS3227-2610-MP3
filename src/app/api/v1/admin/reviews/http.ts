import { adminReviewService, authGuards } from "../../../../../server/composition";
import { errorResponse, parseId, readIfMatch, readJsonBody, runRoute, versionedJsonResponse } from "../../../../../server/http";
import { parseAdminReviewReason } from "../../../../../server/services/moderation/admin-review-input";
import type { AdminReviewService } from "../../../../../server/services/moderation/admin-reviews";

export interface ReviewRouteContext { readonly params: Promise<{ readonly id: string }> }

/** Shared transport checks; the route supplies its named domain operation. */
export function reviewMutationRoute(select: (service: AdminReviewService) => AdminReviewService["approve"]) {
  return (request: Request, context: ReviewRouteContext): Promise<Response> => runRoute(async (routed, requestId) => {
    if (authGuards === null || adminReviewService === null) return errorResponse({ kind: "unavailable" }, requestId);
    const principal = await authGuards.requireActiveAdminMutation(routed);
    if (!principal.ok) return errorResponse(principal.error, requestId);
    const reviewId = parseId<"ReviewId">((await context.params).id);
    if (!reviewId.ok) return errorResponse(reviewId.error, requestId);
    const expected = readIfMatch(routed);
    if (!expected.ok) return errorResponse(expected.error, requestId);
    const input = await readJsonBody(routed, parseAdminReviewReason);
    if (!input.ok) return errorResponse(input.error, requestId);
    const result = await select(adminReviewService)(principal.value, reviewId.value, expected.value, input.value, requestId);
    return result.ok ? versionedJsonResponse(200, result.value, result.value.version) : errorResponse(result.error, requestId);
  })(request);
}
