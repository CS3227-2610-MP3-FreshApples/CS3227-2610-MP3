import { connection } from "next/server";

import { checkReadiness } from "../../../../../server/composition";
import { readinessUnavailableLogLine, type Readiness } from "../../../../../server/services/health";
import { healthResponse, newRequestId } from "../health-response";

const UNEXPECTED_ERROR: Readiness = { ready: false, reason: "unexpected_error" };

async function readinessOrUnexpected(): Promise<Readiness> {
  try {
    return await checkReadiness();
  } catch {
    return UNEXPECTED_ERROR;
  }
}

/**
 * Readiness (api.md 8.4, D-38): 200 when core configuration is valid and the database probe succeeds within
 * 2 seconds, otherwise 503 with one D-39 log line. HEAD is served by this handler.
 */
export async function GET(): Promise<Response> {
  // Outside the try: during prerendering connection() suspends, and that must not become a 503.
  await connection();
  const requestId = newRequestId();
  const readiness = await readinessOrUnexpected();
  if (readiness.ready) {
    return healthResponse({ status: "ready" }, 200, requestId);
  }
  console.error(readinessUnavailableLogLine(requestId, readiness));
  return healthResponse({ status: "unavailable" }, 503, requestId);
}
