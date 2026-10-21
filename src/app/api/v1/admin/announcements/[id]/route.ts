import { adminAnnouncementService, authGuards } from "../../../../../../server/composition";
import { parseAnnouncementPatchInput } from "../../../../../../server/services/announcements";
import { errorResponse, readIfMatch, readJsonBody, runRoute, versionedJsonResponse } from "../../../../../../server/http";
import {
  announcementActor,
  announcementIdFrom,
  versionedNoContentResponse,
  type AnnouncementRouteContext,
} from "../http";

/** GET /api/v1/admin/announcements/:id: the full Announcement and version, in any state. */
export function GET(request: Request, context: AnnouncementRouteContext): Promise<Response> {
  return runRoute(async (routed, id) => {
    if (authGuards === null || adminAnnouncementService === null) return errorResponse({ kind: "unavailable" }, id);
    const principal = await authGuards.requireActiveAdmin(routed);
    if (!principal.ok) return errorResponse(principal.error, id);
    const announcementId = await announcementIdFrom(context);
    if (!announcementId.ok) return errorResponse(announcementId.error, id);
    const announcement = await adminAnnouncementService.get(announcementId.value);
    if (!announcement.ok) return errorResponse(announcement.error, id);
    return versionedJsonResponse(200, announcement.value, announcement.value.version);
  })(request);
}

/** PATCH /api/v1/admin/announcements/:id: content and state with If-Match; 200 even for a no-op (D-79–D-81). */
export function PATCH(request: Request, context: AnnouncementRouteContext): Promise<Response> {
  return runRoute(async (routed, id) => {
    if (authGuards === null || adminAnnouncementService === null) return errorResponse({ kind: "unavailable" }, id);
    const principal = await authGuards.requireActiveAdminMutation(routed);
    if (!principal.ok) return errorResponse(principal.error, id);
    const announcementId = await announcementIdFrom(context);
    if (!announcementId.ok) return errorResponse(announcementId.error, id);
    const expected = readIfMatch(routed);
    if (!expected.ok) return errorResponse(expected.error, id);
    const changes = await readJsonBody(routed, parseAnnouncementPatchInput);
    if (!changes.ok) return errorResponse(changes.error, id);
    const announcement = await adminAnnouncementService.update(
      announcementId.value,
      expected.value,
      changes.value,
      announcementActor(principal.value, id),
    );
    if (!announcement.ok) return errorResponse(announcement.error, id);
    return versionedJsonResponse(200, announcement.value, announcement.value.version);
  })(request);
}

/** DELETE /api/v1/admin/announcements/:id: soft delete; 204 with the resulting ETag, a no-op when deleted (D-79, D-81). */
export function DELETE(request: Request, context: AnnouncementRouteContext): Promise<Response> {
  return runRoute(async (routed, id) => {
    if (authGuards === null || adminAnnouncementService === null) return errorResponse({ kind: "unavailable" }, id);
    const principal = await authGuards.requireActiveAdminMutation(routed);
    if (!principal.ok) return errorResponse(principal.error, id);
    const announcementId = await announcementIdFrom(context);
    if (!announcementId.ok) return errorResponse(announcementId.error, id);
    const expected = readIfMatch(routed);
    if (!expected.ok) return errorResponse(expected.error, id);
    const version = await adminAnnouncementService.delete(announcementId.value, expected.value, announcementActor(principal.value, id));
    if (!version.ok) return errorResponse(version.error, id);
    return versionedNoContentResponse(version.value);
  })(request);
}
