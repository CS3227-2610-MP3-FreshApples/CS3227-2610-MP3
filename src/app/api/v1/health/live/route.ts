import { connection } from "next/server";

import { healthResponse, newRequestId } from "../health-response";

/**
 * Liveness (api.md 8.4, D-38): 200 whenever the process can run this handler. Reads no configuration and
 * imports nothing from the composition root, the database or any adapter. HEAD is served by this handler.
 */
export async function GET(): Promise<Response> {
  await connection();
  return healthResponse({ status: "ok" }, 200, newRequestId());
}
