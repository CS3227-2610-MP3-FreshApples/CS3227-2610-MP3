import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  jsonResponse,
  listResponse,
  noContentResponse,
  parseId,
  readIfMatch,
  readPageRequest,
  versionedJsonResponse,
} from "../../../src/server/http";

describe("K2 pagination and identifiers", () => {
  it("applies the documented pagination defaults and accepts bounded values", () => {
    expect(readPageRequest(new URL("https://app.example.test/api/v1/items"))).toEqual({
      ok: true,
      value: { page: 1, pageSize: 20 },
    });
    expect(readPageRequest(new URL("https://app.example.test/api/v1/items?page=2&pageSize=100"))).toEqual({
      ok: true,
      value: { page: 2, pageSize: 100 },
    });
  });

  it.each(["0", "-1", "1.5", "abc"])("rejects invalid page values: %s", (page) => {
    expect(readPageRequest(new URL(`https://app.example.test/api/v1/items?page=${page}`))).toEqual({
      ok: false,
      error: { kind: "invalid_fields", fieldErrors: { page: ["must be a positive integer"] } },
    });
  });

  it.each(["0", "101", "1.5", "abc"])("rejects invalid pageSize values: %s", (pageSize) => {
    expect(readPageRequest(new URL(`https://app.example.test/api/v1/items?pageSize=${pageSize}`))).toEqual({
      ok: false,
      error: { kind: "invalid_fields", fieldErrors: { pageSize: ["must be an integer from 1 to 100"] } },
    });
  });

  it("accepts canonical UUIDs and maps malformed IDs to not_found", () => {
    expect(parseId<"MovieId">("123e4567-e89b-12d3-a456-426614174000")).toEqual({
      ok: true,
      value: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(parseId<"MovieId">("not-a-uuid")).toEqual({ ok: false, error: { kind: "not_found" } });
  });
});

describe("K2 If-Match and response helpers", () => {
  it("parses only a single quoted integer If-Match value", () => {
    expect(readIfMatch(new Request("https://app.example.test"))).toEqual({
      ok: false,
      error: { kind: "precondition_required" },
    });
    expect(readIfMatch(new Request("https://app.example.test", { headers: { "If-Match": '"3"' } }))).toEqual({
      ok: true,
      value: 3,
    });

    for (const value of ['W/"3"', '"3", "4"', "*", "3", '"-1"']) {
      expect(readIfMatch(new Request("https://app.example.test", { headers: { "If-Match": value } }))).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    }

    expect(readIfMatch(new Request("https://app.example.test", {
      headers: { "If-Match": '"999999999999999999999999"' },
    }))).toEqual({ ok: false, error: { kind: "malformed" } });
  });

  it("returns the documented list, ETag and no-content shapes", async () => {
    const json = jsonResponse(201, { created: true });
    const versioned = versionedJsonResponse(200, { id: "movie" }, 3 as never);
    const list = listResponse({ page: 2, pageSize: 20 }, [{ id: "movie" }], 21);
    const empty = noContentResponse();

    expect(json.status).toBe(201);
    expect(await json.json()).toEqual({ created: true });
    expect(versioned.headers.get("ETag")).toBe('"3"');
    expect(await versioned.json()).toEqual({ id: "movie" });
    expect(await list.json()).toEqual({ items: [{ id: "movie" }], page: 2, pageSize: 20, total: 21 });
    expect(empty.status).toBe(204);
    expect(await empty.text()).toBe("");
    for (const response of [json, versioned, list, empty]) {
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});
