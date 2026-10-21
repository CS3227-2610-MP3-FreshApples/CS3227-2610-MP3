import { publicSummaryReadService } from "../../../../../../server/composition";
import { errorResponse, jsonResponse, parseId, runRoute } from "../../../../../../server/http";

/** A read-only route; deployment.md asks for smaller deadlines than the AI routes' 120 seconds (D-98). */
export const maxDuration = 15;

/**
 * FR-08 public summary state (D-90, D-98). Read-only: it never starts generation, calls K10 or writes. An unknown,
 * malformed or archived Movie is 404.
 */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return runRoute(async (_request, requestId) => {
    const movieId = parseId<"MovieId">((await context.params).id);
    if (!movieId.ok) return errorResponse(movieId.error, requestId);
    if (publicSummaryReadService === null) return errorResponse({ kind: "unavailable" }, requestId);

    const view = await publicSummaryReadService.getSummary(movieId.value);
    return view === null ? errorResponse({ kind: "not_found" }, requestId) : jsonResponse(200, view);
  })(request);
}
