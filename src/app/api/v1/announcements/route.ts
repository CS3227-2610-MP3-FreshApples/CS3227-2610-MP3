import { publicAnnouncementReadService } from "../../../../server/composition";
import { errorResponse, listResponse, readPageRequest, runRoute } from "../../../../server/http";

export const GET = runRoute(async (request, requestId) => {
  const page = readPageRequest(new URL(request.url));
  if (!page.ok) return errorResponse(page.error, requestId);
  if (publicAnnouncementReadService === null) {
    return errorResponse({ kind: "unavailable" }, requestId);
  }

  const result = await publicAnnouncementReadService.listAnnouncements(page.value);
  return listResponse(page.value, result.items, result.total);
});
