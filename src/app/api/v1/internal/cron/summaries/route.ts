import { connection } from "next/server";

import { authGuards, securityLog, summarySweep } from "../../../../../../server/composition";
import { errorResponse, jsonResponse, runRoute } from "../../../../../../server/http";

/** One awaited generation fits within the 120-second function limit (AI-01, deployment.md). */
export const maxDuration = 120;

const sweepRoute = runRoute(async (request, requestId) => {
  // D-98: core configuration is invalid, so neither the guard nor the sweep exists.
  if (authGuards === null || summarySweep === null) return errorResponse({ kind: "unavailable" }, requestId);
  if (!authGuards.requireCronCaller(request).ok) {
    securityLog.record({ event: "access.denied", requestId, code: "unauthenticated" });
    return errorResponse({ kind: "unauthenticated" }, requestId);
  }

  const swept = await summarySweep.run(requestId);
  if (!swept.ok) return errorResponse(swept.error, requestId);
  const { processed, skipped, deferred, failed } = swept.value;
  return jsonResponse(200, { processed, skipped, deferred, failed });
});

/**
 * DEP-09 summary sweep for Vercel cron (D-89, D-94, D-98). Only `Authorization: Bearer <CRON_SECRET>` is
 * accepted; an Admin session alone is 401. Returns aggregate counts only.
 */
export async function GET(request: Request): Promise<Response> {
  // Before any work: under cacheComponents this route must never be prerendered (D-98).
  await connection();
  return sweepRoute(request);
}
