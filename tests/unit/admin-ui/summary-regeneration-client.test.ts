import { describe, expect, it } from "vitest";

import type { Fetcher } from "../../../src/app/admin/_lib/admin-http";
import { regenerateMovieSummary } from "../../../src/app/admin/_lib/movie-client";

const MOVIE_ID = "00000000-0000-4000-8000-0000000000a1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Call = Readonly<{ input: string; init?: RequestInit }>;

function api(response: Response): { calls: Call[]; fetcher: Fetcher } {
  const calls: Call[] = [];
  return {
    calls,
    fetcher: async (input, init) => {
      calls.push({ input: String(input), init });
      return String(input) === "/api/v1/auth/csrf" ? json({ csrfToken: "csrf_v1.synthetic" }) : response;
    },
  };
}

describe("Admin summary regeneration client", () => {
  it.each(["generated", "pending", "insufficient_reviews"] as const)("accepts the documented %s outcome", async (status) => {
    const { calls, fetcher } = api(json({ status }));

    await expect(regenerateMovieSummary(MOVIE_ID, fetcher)).resolves.toEqual({ ok: true, value: { status } });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.input).toBe(`/api/v1/admin/movies/${MOVIE_ID}/summary/regenerate`);
    expect(calls[1]?.init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      body: "{}",
    });
    expect(calls[1]?.init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-CSRF-Token": "csrf_v1.synthetic",
    });
    expect((calls[1]?.init?.headers as Record<string, string>)["If-Match"]).toBeUndefined();
  });

  it.each([
    {},
    { status: "unknown" },
    { status: "generated", jobId: "private" },
    { status: "generated", detail: null },
  ])("rejects an invalid or expanded response DTO", async (body) => {
    const { fetcher } = api(json(body));
    await expect(regenerateMovieSummary(MOVIE_ID, fetcher)).resolves.toMatchObject({ ok: false, kind: "unavailable" });
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
  ] as const)("maps HTTP %i to %s without retrying", async (status, kind) => {
    const { calls, fetcher } = api(json({ error: { code: "forbidden", message: "unsafe provider detail", requestId: "r" } }, status));
    await expect(regenerateMovieSummary(MOVIE_ID, fetcher)).resolves.toMatchObject({ ok: false, kind });
    expect(calls).toHaveLength(2);
  });

  it("encodes the movie id without changing the endpoint", async () => {
    const { calls, fetcher } = api(json({ status: "pending" }));
    await regenerateMovieSummary("../users", fetcher);
    expect(calls[1]?.input).toBe("/api/v1/admin/movies/..%2Fusers/summary/regenerate");
  });
});
