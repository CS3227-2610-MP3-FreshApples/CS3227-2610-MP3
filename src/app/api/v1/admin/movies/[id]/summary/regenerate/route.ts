import {
  adminSummaryRegenerationService,
  authGuards,
} from "../../../../../../../../server/composition";
import { errorResponse, jsonResponse, readJsonBody, runRoute } from "../../../../../../../../server/http";
import { parseAdminSummaryRegenerationInput } from "../../../../../../../../server/services/ai/summary";
import { movieIdFrom, type MovieRouteContext } from "../../../http";

export const maxDuration = 120;

/** POST /api/v1/admin/movies/:id/summary/regenerate: invalidate and attempt one bounded Admin generation. */
export function POST(request: Request, context: MovieRouteContext): Promise<Response> {
  return runRoute(async (routed, requestId) => {
    if (authGuards === null || adminSummaryRegenerationService === null) {
      return errorResponse({ kind: "unavailable" }, requestId);
    }
    const principal = await authGuards.requireActiveAdminMutation(routed);
    if (!principal.ok) return errorResponse(principal.error, requestId);
    const movieId = await movieIdFrom(context);
    if (!movieId.ok) return errorResponse(movieId.error, requestId);
    const input = await readJsonBody(routed, parseAdminSummaryRegenerationInput);
    if (!input.ok) return errorResponse(input.error, requestId);
    const result = await adminSummaryRegenerationService.regenerate(movieId.value, principal.value, requestId);
    return result.ok ? jsonResponse(200, result.value) : errorResponse(result.error, requestId);
  })(request);
}
