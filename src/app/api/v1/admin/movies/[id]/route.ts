import { adminMovieService, authGuards, movieArchiveService } from "../../../../../../server/composition";
import { parseMoviePatchInput } from "../../../../../../server/services/catalogue";
import { errorResponse, readIfMatch, readJsonBody, runRoute, versionedJsonResponse } from "../../../../../../server/http";
import { adminActor, movieIdFrom, versionedNoContentResponse, type MovieRouteContext } from "../http";

/** GET /api/v1/admin/movies/:id: current metadata, archive state and version. */
export function GET(request: Request, context: MovieRouteContext): Promise<Response> {
  return runRoute(async (routed, id) => {
    if (authGuards === null || adminMovieService === null) return errorResponse({ kind: "unavailable" }, id);
    const principal = await authGuards.requireActiveAdmin(routed);
    if (!principal.ok) return errorResponse(principal.error, id);
    const movieId = await movieIdFrom(context);
    if (!movieId.ok) return errorResponse(movieId.error, id);
    const movie = await adminMovieService.get(movieId.value);
    if (!movie.ok) return errorResponse(movie.error, id);
    return versionedJsonResponse(200, movie.value, movie.value.version);
  })(request);
}

/** PATCH /api/v1/admin/movies/:id: writable fields with If-Match; 200 even for a no-op (D-80, D-81). */
export function PATCH(request: Request, context: MovieRouteContext): Promise<Response> {
  return runRoute(async (routed, id) => {
    if (authGuards === null || adminMovieService === null) return errorResponse({ kind: "unavailable" }, id);
    const principal = await authGuards.requireActiveAdminMutation(routed);
    if (!principal.ok) return errorResponse(principal.error, id);
    const movieId = await movieIdFrom(context);
    if (!movieId.ok) return errorResponse(movieId.error, id);
    const expected = readIfMatch(routed);
    if (!expected.ok) return errorResponse(expected.error, id);
    const changes = await readJsonBody(routed, parseMoviePatchInput);
    if (!changes.ok) return errorResponse(changes.error, id);
    const movie = await adminMovieService.update(movieId.value, expected.value, changes.value, adminActor(principal.value, id));
    if (!movie.ok) return errorResponse(movie.error, id);
    return versionedJsonResponse(200, movie.value, movie.value.version);
  })(request);
}

/** DELETE /api/v1/admin/movies/:id: archive; 204 with the resulting ETag, a no-op when archived (D-79, D-81). */
export function DELETE(request: Request, context: MovieRouteContext): Promise<Response> {
  return runRoute(async (routed, id) => {
    if (authGuards === null || movieArchiveService === null) return errorResponse({ kind: "unavailable" }, id);
    const principal = await authGuards.requireActiveAdminMutation(routed);
    if (!principal.ok) return errorResponse(principal.error, id);
    const movieId = await movieIdFrom(context);
    if (!movieId.ok) return errorResponse(movieId.error, id);
    const expected = readIfMatch(routed);
    if (!expected.ok) return errorResponse(expected.error, id);
    const version = await movieArchiveService.archive(movieId.value, expected.value, adminActor(principal.value, id));
    if (!version.ok) return errorResponse(version.error, id);
    return versionedNoContentResponse(version.value);
  })(request);
}
