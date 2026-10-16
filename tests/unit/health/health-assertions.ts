import { expect } from "vitest";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Headers every health response carries (D-38). Returns the response's request ID. */
export function expectHealthHeaders(response: Response): string {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toMatch(/^application\/json(;|$)/);
  expect(response.headers.get("set-cookie")).toBeNull();
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toMatch(UUID);
  return requestId as string;
}

/** Parses the single D-39 line written to `console.error`. */
export function loggedLine(calls: readonly unknown[][]): Record<string, unknown> {
  expect(calls).toHaveLength(1);
  expect(calls[0]).toHaveLength(1);
  const [line] = calls[0];
  expect(typeof line).toBe("string");
  expect(line).not.toContain("\n");
  return JSON.parse(line as string) as Record<string, unknown>;
}

/** Calls a handler that takes no request with one anyway, as Next.js does. */
export function callWithRequest(handler: () => Promise<Response>, request: Request): Promise<Response> {
  return (handler as (request: Request) => Promise<Response>)(request);
}

/** A request carrying an inbound request ID, a cookie and a session header, all of which must be ignored. */
export function requestWithClientHeaders(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: {
      "x-request-id": "client-supplied-request-id",
      cookie: "session=synthetic-session-cookie",
      authorization: "Bearer synthetic-token",
    },
  });
}
