import { timingSafeEqual } from "node:crypto";

import { config, firstAdminBootstrapService, securityLog } from "../../../../../../server/composition";
import { errorResponse, runRoute } from "../../../../../../server/http";
import { response } from "../../../auth/http";

function matchesSecret(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** Dedicated deployment-only operation. It is never called by startup, build, or browser auth flows. */
export const POST = runRoute(async (request, id) => {
  if (!config.bootstrap.enabled || firstAdminBootstrapService === null) return errorResponse({ kind: "unavailable" }, id);
  if (!matchesSecret(request.headers.get("x-admin-bootstrap-secret"), config.bootstrap.secret)) {
    securityLog.record({ event: "access.denied", requestId: id, code: "forbidden" });
    return errorResponse({ kind: "forbidden" }, id);
  }

  const result = await firstAdminBootstrapService.bootstrap({
    email: config.bootstrap.email,
    password: config.bootstrap.password,
    requestId: id,
  });
  if (!result.ok) {
    return errorResponse(result.error === "invalid_fields" ? { kind: "unavailable" } : { kind: "conflict" }, id);
  }
  return response({ status: result.status }, 200);
});
