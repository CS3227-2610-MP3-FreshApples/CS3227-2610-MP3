import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { TransactionConflict } from "../../../src/server/shared/errors";
import { errorResponse, runRoute } from "../../../src/server/http";

const requestIdPattern = /^[0-9a-f-]{36}$/;

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("K2 request identity and error mapping", () => {
  it("maps every domain error to the documented status and code", async () => {
    const cases = [
      [{ kind: "malformed" }, 400, "malformed_request"],
      [{ kind: "unauthenticated" }, 401, "unauthenticated"],
      [{ kind: "forbidden" }, 403, "forbidden"],
      [{ kind: "csrf_failed" }, 403, "csrf_failed"],
      [{ kind: "not_found" }, 404, "not_found"],
      [{ kind: "conflict" }, 409, "conflict"],
      [{ kind: "stale_version" }, 409, "stale_version"],
      [{ kind: "payload_too_large" }, 413, "payload_too_large"],
      [{ kind: "unsupported_media_type" }, 415, "unsupported_media_type"],
      [{ kind: "invalid_fields", fieldErrors: { name: ["invalid"] } }, 422, "validation_failed"],
      [{ kind: "precondition_required" }, 428, "precondition_required"],
      [{ kind: "rate_limited", retryAfterSeconds: 7 }, 429, "rate_limited"],
      [{ kind: "unavailable" }, 503, "service_unavailable"],
    ] as const;

    for (const [error, status, code] of cases) {
      const response = errorResponse(error, "00000000-0000-4000-8000-000000000001" as never);
      const body = await responseJson(response);
      const errorBody = body.error as Record<string, unknown>;

      expect(response.status).toBe(status);
      expect(errorBody.code).toBe(code);
      expect(errorBody.requestId).toBe(response.headers.get("X-Request-Id"));
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }

    const rateLimited = errorResponse(
      { kind: "rate_limited", retryAfterSeconds: 7 },
      "00000000-0000-4000-8000-000000000001" as never,
    );
    expect(rateLimited.headers.get("Retry-After")).toBe("7");
  });

  it("generates a request ID, ignores an inbound ID, and adds it to success responses", async () => {
    const route = runRoute(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const response = await route(new Request("https://app.example.test/api/v1/example", {
      headers: { "X-Request-Id": "client-supplied" },
    }));

    expect(response.headers.get("X-Request-Id")).toMatch(requestIdPattern);
    expect(response.headers.get("X-Request-Id")).not.toBe("client-supplied");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("maps transaction conflicts and unexpected errors to safe responses", async () => {
    const conflict = await runRoute(async () => {
      throw new TransactionConflict();
    })(new Request("https://app.example.test/api/v1/example"));
    const unexpected = await runRoute(async () => {
      throw new Error("secret database detail");
    })(new Request("https://app.example.test/api/v1/example"));

    expect(conflict.status).toBe(409);
    expect((await responseJson(conflict)).error).toMatchObject({ code: "conflict" });
    expect(unexpected.status).toBe(500);
    expect(await unexpected.text()).not.toContain("secret database detail");
  });
});
