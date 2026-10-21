import { describe, expect, it } from "vitest";

import { listOwnReviews, pageFromSearchParam } from "../../../src/app/app/reviews/_lib/review-client";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("My reviews client", () => {
  it("maps the page URL to the requested private review page", () => {
    expect(pageFromSearchParam("2")).toBe(2);
    expect(pageFromSearchParam("0")).toBe(1);
    expect(pageFromSearchParam("not-a-page")).toBe(1);
    expect(pageFromSearchParam(["3", "4"])).toBe(1);
  });

  it("requests the private page without caching and accepts an empty page", async () => {
    let request: RequestInfo | URL | undefined;
    let options: RequestInit | undefined;
    const result = await listOwnReviews(2, async (input, init) => {
      request = input;
      options = init;
      return response(200, { items: [], page: 2, pageSize: 20, total: 0 });
    });

    expect(result).toEqual({ ok: true, value: { items: [], page: 2, pageSize: 20, total: 0 } });
    expect(request).toBe("/api/v1/me/reviews?page=2&pageSize=20");
    expect(options).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  });

  it("maps an expired session and malformed success body to safe messages", async () => {
    await expect(listOwnReviews(1, async () => response(401, { error: { code: "unauthenticated" } }))).resolves.toEqual({
      ok: false,
      message: "Your session has ended. Sign in again to continue.",
    });
    await expect(listOwnReviews(1, async () => response(200, { items: [{ body: "unexpected" }] }))).resolves.toEqual({
      ok: false,
      message: "We could not load your reviews. Please try again.",
    });
  });
});
