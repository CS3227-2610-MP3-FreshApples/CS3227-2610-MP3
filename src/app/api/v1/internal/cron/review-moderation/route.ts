import { connection } from "next/server";

import { authGuards, moderationSweep, rateLimiter, securityLog } from "../../../../../../server/composition";
import { errorResponse, jsonResponse, runRoute } from "../../../../../../server/http";

/** One awaited screening fits within the 120-second function limit (AI-03, deployment.md). */
export const maxDuration = 120;

const sweepRoute = runRoute(async (request, requestId) => {
  // D-101, as D-98: core configuration is invalid, so neither the guard nor the sweep exists.
  if (authGuards === null || rateLimiter === null || moderationSweep === null) {
    return errorResponse({ kind: "unavailable" }, requestId);
  }
  if (!authGuards.requireCronCaller(request).ok) {
    securityLog.record({ event: "access.denied", requestId, code: "unauthenticated" });
    return errorResponse({ kind: "unauthenticated" }, requestId);
  }

  // D-45: once per invocation, after the secret check and before the sweep; a failure never stops the sweep.
  try {
    await rateLimiter.purgeExpired();
  } catch {
    securityLog.record({ event: "rate_limit.purge_failed", requestId });
  }

  const swept = await moderationSweep.run(requestId);
  if (!swept.ok) return errorResponse(swept.error, requestId);
  const { processed, skipped, deferred, failed } = swept.value;
  return jsonResponse(200, { processed, skipped, deferred, failed });
});

/**
 * DEP-10 review-moderation recovery sweep for Vercel cron (AI-02, D-101). Only `Authorization: Bearer
 * <CRON_SECRET>` is accepted; an Admin session alone is 401. Returns aggregate counts only.
 */
export async function GET(request: Request): Promise<Response> {
  // Before any work: under cacheComponents this route must never be prerendered (D-98).
  await connection();
  return sweepRoute(request);
}
