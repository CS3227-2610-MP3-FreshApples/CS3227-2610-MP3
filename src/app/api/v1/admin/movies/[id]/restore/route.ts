import { authGuards, movieArchiveService } from "../../../../../../../server/composition";
import { errorResponse, readIfMatch, runRoute, versionedJsonResponse } from "../../../../../../../server/http";
import { adminActor, movieIdFrom, type MovieRouteContext } from "../../http";

/** POST /api/v1/admin/movies/:id/restore: 200 with the Movie and ETag, a no-op when active (D-79, D-81). */
export function POST(request: Request, context: MovieRouteContext): Promise<Response> {
  return runRoute(async (routed, id) => {
    if (authGuards === null || movieArchiveService === null) return errorResponse({ kind: "unavailable" }, id);
    const principal = await authGuards.requireActiveAdminMutation(routed);
    if (!principal.ok) return errorResponse(principal.error, id);
    const movieId = await movieIdFrom(context);
    if (!movieId.ok) return errorResponse(movieId.error, id);
    const expected = readIfMatch(routed);
    if (!expected.ok) return errorResponse(expected.error, id);
    const movie = await movieArchiveService.restore(movieId.value, expected.value, adminActor(principal.value, id));
    if (!movie.ok) return errorResponse(movie.error, id);
    return versionedJsonResponse(200, movie.value, movie.value.version);
  })(request);
}
