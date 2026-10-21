import { publicCatalogueReadService } from "../../../../server/composition";
import { errorResponse, listResponse, readPageRequest, runRoute } from "../../../../server/http";
import { normalizePublicMovieListQuery } from "../../../../server/services/catalogue";

export const GET = runRoute(async (request, requestId) => {
  const url = new URL(request.url);
  const page = readPageRequest(url);
  if (!page.ok) return errorResponse(page.error, requestId);

  const query = normalizePublicMovieListQuery({
    q: url.searchParams.get("q") ?? undefined,
    sort: url.searchParams.get("sort"),
    page: page.value.page,
    pageSize: page.value.pageSize,
  });
  if (!query.ok) {
    return errorResponse({ kind: "invalid_fields", fieldErrors: query.error }, requestId);
  }
  if (publicCatalogueReadService === null) {
    return errorResponse({ kind: "unavailable" }, requestId);
  }

  const result = await publicCatalogueReadService.listMovies(query.value);
  return listResponse(page.value, result.items, result.total);
});
