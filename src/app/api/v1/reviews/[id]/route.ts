import { authGuards, reviewService } from "../../../../../server/composition";
import { errorResponse, noContentResponse, parseId, readIfMatch, readJsonBody, runRoute, versionedJsonResponse } from "../../../../../server/http";
import { parseReviewPatchInput, projectOwnReview } from "../../../../../server/services/reviews";
import type { ReviewId } from "../../../../../server/shared";

export const maxDuration = 120;

export const PATCH = (
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> => runRoute(async (routed, requestId) => {
  if (authGuards === null || reviewService === null) return errorResponse({ kind: "unavailable" }, requestId);
  const principal = await authGuards.requireActiveUserMutation(routed);
  if (!principal.ok) return errorResponse(principal.error, requestId);
  const admission = await reviewService.admit(principal.value.accountId);
  if (!admission.ok) return errorResponse(admission.error, requestId);
  const reviewId = parseId<"ReviewId">((await context.params).id);
  if (!reviewId.ok) return errorResponse(reviewId.error, requestId);
  const expected = readIfMatch(routed);
  if (!expected.ok) return errorResponse(expected.error, requestId);
  const body = await readJsonBody(routed, parseReviewPatchInput);
  if (!body.ok) return errorResponse(body.error, requestId);
  const result = await reviewService.edit(reviewId.value as ReviewId, principal.value.accountId, expected.value, body.value);
  if (!result.ok) return errorResponse(result.error, requestId);
  return versionedJsonResponse(200, { ...projectOwnReview(result.value), moderationState: result.value.moderationState, message: result.value.moderationState === "pending" ? "Review saved and is pending moderation." : "Review saved." }, result.value.version);
})(request);

export const DELETE = (
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> => runRoute(async (routed, requestId) => {
  if (authGuards === null || reviewService === null) return errorResponse({ kind: "unavailable" }, requestId);
  const principal = await authGuards.requireActiveUserMutation(routed);
  if (!principal.ok) return errorResponse(principal.error, requestId);
  const admission = await reviewService.admit(principal.value.accountId);
  if (!admission.ok) return errorResponse(admission.error, requestId);
  const reviewId = parseId<"ReviewId">((await context.params).id);
  if (!reviewId.ok) return errorResponse(reviewId.error, requestId);
  const expected = readIfMatch(routed);
  if (!expected.ok) return errorResponse(expected.error, requestId);
  const result = await reviewService.delete(reviewId.value as ReviewId, principal.value.accountId, expected.value);
  if (!result.ok) return errorResponse(result.error, requestId);
  const response = noContentResponse();
  response.headers.set("ETag", `"${result.value.version}"`);
  return response;
})(request);
