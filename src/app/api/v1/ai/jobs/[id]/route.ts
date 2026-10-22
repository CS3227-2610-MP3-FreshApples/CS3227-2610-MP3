import { authGuards, moderationJobReadService } from "../../../../../../server/composition";
import { errorResponse, jsonResponse, parseId, runRoute } from "../../../../../../server/http";

/** The Next.js 16 context of a `[id]` Route Handler. */
interface JobRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/**
 * GET /api/v1/ai/jobs/:id: the safe status of one review-moderation job, for active Admins only (D-102). A
 * malformed ID, an unknown ID and a summary job are all 404. It never dispatches or retries work.
 */
export function GET(request: Request, context: JobRouteContext): Promise<Response> {
  return runRoute(async (routed, requestId) => {
    if (authGuards === null || moderationJobReadService === null) {
      return errorResponse({ kind: "unavailable" }, requestId);
    }
    const principal = await authGuards.requireActiveAdmin(routed);
    if (!principal.ok) return errorResponse(principal.error, requestId);
    const jobId = parseId<"AiJobId">((await context.params).id);
    if (!jobId.ok) return errorResponse(jobId.error, requestId);
    const job = await moderationJobReadService.read(jobId.value);
    if (job === null) return errorResponse({ kind: "not_found" }, requestId);
    return jsonResponse(200, job);
  })(request);
}
