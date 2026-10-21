import { authGuards, reviewReadService, reviewService } from "../../../../../../server/composition";
import { errorResponse, listResponse, parseId, readJsonBody, readPageRequest, runRoute, versionedJsonResponse } from "../../../../../../server/http";
import { parseReviewCreateInput, projectOwnReview } from "../../../../../../server/services/reviews";
import type { MovieId } from "../../../../../../server/shared";

export const maxDuration = 120;

export const POST = (
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> => runRoute(async (routed, requestId) => {
  if (authGuards === null || reviewService === null) return errorResponse({ kind: "unavailable" }, requestId);
  const principal = await authGuards.requireActiveUserMutation(routed);
  if (!principal.ok) return errorResponse(principal.error, requestId);
  const admission = await reviewService.admit(principal.value.accountId);
  if (!admission.ok) return errorResponse(admission.error, requestId);
  const movieId = parseId<"MovieId">((await context.params).id);
  if (!movieId.ok) return errorResponse(movieId.error, requestId);
  const body = await readJsonBody(routed, parseReviewCreateInput);
  if (!body.ok) return errorResponse(body.error, requestId);
  const result = await reviewService.create(movieId.value as MovieId, principal.value.accountId, body.value);
  if (!result.ok) return errorResponse(result.error, requestId);
  return versionedJsonResponse(201, { ...projectOwnReview(result.value), moderationState: result.value.moderationState, message: savedMessage(result.value.moderationState) }, result.value.version);
})(request);

function savedMessage(state: string): string {
  return state === "pending" ? "Review saved and is pending moderation." : "Review saved.";
}

export const GET = (
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> => runRoute(async (routed, requestId) => {
  if (reviewReadService === null) return errorResponse({ kind: "unavailable" }, requestId);
  const movieId = parseId<"MovieId">((await context.params).id);
  if (!movieId.ok) return errorResponse(movieId.error, requestId);
  const page = readPageRequest(new URL(routed.url));
  if (!page.ok) return errorResponse(page.error, requestId);
  const result = await reviewReadService.listPublic(movieId.value, page.value.page, page.value.pageSize);
  if (result === null) return errorResponse({ kind: "not_found" }, requestId);
  return listResponse(page.value, result.items, result.total);
})(request);
