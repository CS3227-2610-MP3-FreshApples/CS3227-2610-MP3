import type { AnnouncementActor, AnnouncementId } from "../../../../../server/services/announcements";
import type { Principal } from "../../../../../server/services/identity";
import { parseId } from "../../../../../server/http";
import type { DomainError, RequestId, Result, RowVersion } from "../../../../../server/shared";

/** The Next.js 16 context of a `[id]` Route Handler. */
export interface AnnouncementRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/** A malformed path ID is 404 (api.md 8.1). */
export async function announcementIdFrom(context: AnnouncementRouteContext): Promise<Result<AnnouncementId, DomainError>> {
  return parseId<"AnnouncementId">((await context.params).id);
}

/** The server-derived audit actor (D-81). */
export function announcementActor(principal: Principal, requestId: RequestId): AnnouncementActor {
  return { actorId: principal.accountId, requestId };
}

/** A versioned DELETE: 204, no body, the resulting version in ETag only (D-81). */
export function versionedNoContentResponse(version: RowVersion): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", ETag: `"${version}"` } });
}
