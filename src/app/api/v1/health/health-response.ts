import { randomUUID } from "node:crypto";

// Health routes set their headers here, not through K2: they never use the K2 error envelope (D-38, AM-06).
// This module reads no configuration, so liveness stays independent of it. The routes declare no `runtime`
// segment config: `cacheComponents` rejects it and always uses the Node.js runtime.

export type HealthBody = { readonly status: "ok" } | { readonly status: "ready" } | { readonly status: "unavailable" };

/** A server-generated request ID; inbound request IDs are ignored (api.md 8.1). */
export function newRequestId(): string {
  return randomUUID();
}

/** A health response: the minimal JSON body, `no-store`, the request ID and no cookies (D-38). */
export function healthResponse(body: HealthBody, status: 200 | 503, requestId: string): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}
