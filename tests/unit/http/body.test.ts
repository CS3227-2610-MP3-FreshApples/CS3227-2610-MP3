import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readJsonBody, trimmedCodePointLength } from "../../../src/server/http";

function request(body: string, contentType?: string): Request {
  return new Request("https://app.example.test/api/v1/example", {
    method: "POST",
    body,
    headers: contentType === undefined ? undefined : { "Content-Type": contentType },
  });
}

describe("K2 JSON body parsing and validation", () => {
  it("accepts JSON content types and returns the validator result", async () => {
    const result = await readJsonBody(request('{"name":"Fresh Apples"}', "application/json; charset=utf-8"), (input) => {
      if (typeof input !== "object" || input === null || !("name" in input)) {
        return { ok: false, error: { name: ["required"] } };
      }
      return { ok: true, value: input as { name: string } };
    });

    expect(result).toEqual({ ok: true, value: { name: "Fresh Apples" } });
  });

  it.each([
    [undefined, "missing content type"],
    ["text/plain", "unsupported content type"],
  ])("rejects %s", async (...args) => {
    const [contentType] = args;
    const result = await readJsonBody(request('{"name":"x"}', contentType), () => ({ ok: true, value: {} }));

    expect(result).toEqual({ ok: false, error: { kind: "unsupported_media_type" } });
  });

  it("rejects malformed JSON and bodies over 32 KiB", async () => {
    const malformed = await readJsonBody(request("{not-json", "application/json"), () => ({ ok: true, value: {} }));
    const oversized = await readJsonBody(request(`"${"a".repeat(32768)}"`, "application/json"), () => ({ ok: true, value: {} }));

    expect(malformed).toEqual({ ok: false, error: { kind: "malformed" } });
    expect(oversized).toEqual({ ok: false, error: { kind: "payload_too_large" } });
  });

  it("accepts an exact 32 KiB UTF-8 body and rejects invalid UTF-8", async () => {
    const exactBody = `"${"a".repeat(32766)}"`;
    const exact = await readJsonBody(request(exactBody, "application/json"), () => ({ ok: true, value: exactBody }));
    const invalidUtf8 = new Request("https://app.example.test/api/v1/example", {
      method: "POST",
      body: new Uint8Array([0x22, 0xc3, 0x28, 0x22]),
      headers: { "Content-Type": "application/json" },
    });
    const invalid = await readJsonBody(invalidUtf8, () => ({ ok: true, value: "unexpected" }));

    expect(exact).toEqual({ ok: true, value: exactBody });
    expect(invalid).toEqual({ ok: false, error: { kind: "malformed" } });
  });

  it("rejects an oversized streamed request without reading beyond the limit", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 100) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const oversized = new Request("https://app.example.test/api/v1/example", {
      method: "POST",
      body,
      duplex: "half",
      headers: { "Content-Type": "application/json" },
    } as RequestInit & { duplex: "half" });

    const result = await readJsonBody(oversized, () => ({ ok: true, value: "unexpected" }));

    expect(result).toEqual({ ok: false, error: { kind: "payload_too_large" } });
    expect(pulls).toBeLessThanOrEqual(33);
  });

  it("returns strict validator field errors for valid JSON with invalid fields", async () => {
    const result = await readJsonBody(request('{"name":"x","unknown":true}', "application/json"), () => ({
      ok: false,
      error: { unknown: ["unrecognized field"] },
    }));

    expect(result).toEqual({ ok: false, error: { kind: "invalid_fields", fieldErrors: { unknown: ["unrecognized field"] } } });
  });

  it("counts trimmed Unicode code points rather than UTF-16 code units", () => {
    expect(trimmedCodePointLength("  😀e\u0301  ")).toBe(3);
  });
});
