import { adminAnnouncementService, authGuards } from "../../../../../server/composition";
import { parseAnnouncementCreateInput } from "../../../../../server/services/announcements";
import {
  errorResponse,
  listResponse,
  readJsonBody,
  readPageRequest,
  runRoute,
  versionedJsonResponse,
} from "../../../../../server/http";
import { announcementActor } from "./http";

/** GET /api/v1/admin/announcements: every state, updated_at DESC, id ASC (D-80). */
export const GET = runRoute(async (request, id) => {
  if (authGuards === null || adminAnnouncementService === null) return errorResponse({ kind: "unavailable" }, id);
  const principal = await authGuards.requireActiveAdmin(request);
  if (!principal.ok) return errorResponse(principal.error, id);
  const page = readPageRequest(new URL(request.url));
  if (!page.ok) return errorResponse(page.error, id);
  const result = await adminAnnouncementService.list(page.value.page, page.value.pageSize);
  return listResponse(page.value, result.items, result.total);
});

/** POST /api/v1/admin/announcements: 201 with the draft and its ETag (D-79, D-81). */
export const POST = runRoute(async (request, id) => {
  if (authGuards === null || adminAnnouncementService === null) return errorResponse({ kind: "unavailable" }, id);
  const principal = await authGuards.requireActiveAdminMutation(request);
  if (!principal.ok) return errorResponse(principal.error, id);
  const body = await readJsonBody(request, parseAnnouncementCreateInput);
  if (!body.ok) return errorResponse(body.error, id);
  const announcement = await adminAnnouncementService.create(body.value, announcementActor(principal.value, id));
  if (!announcement.ok) return errorResponse(announcement.error, id);
  return versionedJsonResponse(201, announcement.value, announcement.value.version);
});
