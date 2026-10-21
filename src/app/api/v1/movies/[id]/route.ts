import { publicCatalogueReadService } from "../../../../../server/composition";
import { errorResponse, jsonResponse, parseId, runRoute } from "../../../../../server/http";

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return runRoute(async (_request, requestId) => {
    const params = await context.params;
    const movieId = parseId<"MovieId">(params.id);
    if (!movieId.ok) return errorResponse(movieId.error, requestId);
    if (publicCatalogueReadService === null) {
      return errorResponse({ kind: "unavailable" }, requestId);
    }

    const movie = await publicCatalogueReadService.getMovie(movieId.value);
    return movie === null
      ? errorResponse({ kind: "not_found" }, requestId)
      : jsonResponse(200, movie);
  })(request);
}
