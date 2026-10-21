import { adminMovieService, authGuards } from "../../../../../server/composition";
import { parseMovieCreateInput } from "../../../../../server/services/catalogue";
import {
  errorResponse,
  listResponse,
  readJsonBody,
  readPageRequest,
  runRoute,
  versionedJsonResponse,
} from "../../../../../server/http";
import { adminActor } from "./http";

/** GET /api/v1/admin/movies: every Movie including archived, updated_at DESC, id ASC (D-80). */
export const GET = runRoute(async (request, id) => {
  if (authGuards === null || adminMovieService === null) return errorResponse({ kind: "unavailable" }, id);
  const principal = await authGuards.requireActiveAdmin(request);
  if (!principal.ok) return errorResponse(principal.error, id);
  const page = readPageRequest(new URL(request.url));
  if (!page.ok) return errorResponse(page.error, id);
  const result = await adminMovieService.list(page.value.page, page.value.pageSize);
  return listResponse(page.value, result.items, result.total);
});

/** POST /api/v1/admin/movies: 201 with the Movie and its ETag (D-81). */
export const POST = runRoute(async (request, id) => {
  if (authGuards === null || adminMovieService === null) return errorResponse({ kind: "unavailable" }, id);
  const principal = await authGuards.requireActiveAdminMutation(request);
  if (!principal.ok) return errorResponse(principal.error, id);
  const body = await readJsonBody(request, parseMovieCreateInput);
  if (!body.ok) return errorResponse(body.error, id);
  const movie = await adminMovieService.create(body.value, adminActor(principal.value, id));
  return versionedJsonResponse(201, movie, movie.version);
});
