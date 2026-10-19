import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { FetchFunction, LlmMessage } from "../../../src/server/adapters/soc-llm";
import { createSocLlmProvider } from "../../../src/server/adapters/soc-llm/soc-llm-provider";
import { describeLlmProviderContract } from "../../support/contracts/llm-provider.contract";

// Synthetic placeholders only; tests make no network call (D-78).
const BASE_URL = "https://soc-llm.test.invalid";
const API_KEY = "clsk_testprefix_synthetic-secret-value";

const MESSAGES: readonly LlmMessage[] = [
  { role: "system", content: "Screen the review." },
  { role: "user", content: "A review body." },
];

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

/** A stub `fetch` that records its calls and answers with `respond`. */
function stubFetch(respond: (call: FetchCall) => Response | Promise<Response>): FetchFunction & {
  readonly calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return Object.assign(fetch, { calls });
}

/** A stub `fetch` that stays pending until the request's signal aborts, then rejects as real fetch does. */
function hangingFetch(): FetchFunction {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
}

function completionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "chatcmpl-1",
    object: "chat.completion",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"assessment":"x"}' } }],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
}

function provider(fetch: FetchFunction, overrides: { baseUrl?: string; model?: string } = {}) {
  return createSocLlmProvider({
    baseUrl: overrides.baseUrl ?? BASE_URL,
    apiKey: API_KEY,
    model: overrides.model ?? "default",
    fetch,
  });
}

function complete(fetch: FetchFunction, signal: AbortSignal = new AbortController().signal) {
  return provider(fetch).complete({ messages: MESSAGES, maxOutputTokens: 1_000, signal });
}

describeLlmProviderContract("SoC adapter with a stub fetch", {
  succeeding: (modelId) =>
    createSocLlmProvider({ baseUrl: BASE_URL, apiKey: API_KEY, model: modelId, fetch: stubFetch(() => jsonResponse(completionBody())) }),
  hanging: (modelId) => createSocLlmProvider({ baseUrl: BASE_URL, apiKey: API_KEY, model: modelId, fetch: hangingFetch() }),
});

describe("SoC adapter — request (D-59, O-27)", () => {
  it("posts exactly the D-59 body to <base>/v1/chat/completions with the key only in Authorization", async () => {
    const fetch = stubFetch(() => jsonResponse(completionBody()));
    const signal = new AbortController().signal;

    await provider(fetch, { model: "default" }).complete({ messages: MESSAGES, maxOutputTokens: 1_200, signal });

    expect(fetch.calls).toHaveLength(1);
    const [{ url, init }] = fetch.calls;
    expect(url).toBe(`${BASE_URL}/v1/chat/completions`);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBe(signal);
    expect(init.headers).toEqual({
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "default",
      messages: [
        { role: "system", content: "Screen the review." },
        { role: "user", content: "A review body." },
      ],
      max_tokens: 1_200,
      stream: false,
      reasoning_effort: "none",
    });
    expect(url).not.toContain(API_KEY);
    expect(init.body as string).not.toContain(API_KEY);
  });

  it("sends only role and content for each message", async () => {
    const fetch = stubFetch(() => jsonResponse(completionBody()));
    const extra = { role: "user", content: "Body.", name: "ignored" } as LlmMessage;

    await provider(fetch).complete({ messages: [extra], maxOutputTokens: 10, signal: new AbortController().signal });

    expect(JSON.parse(fetch.calls[0].init.body as string).messages).toEqual([{ role: "user", content: "Body." }]);
  });

  it("does not double the slash when the base URL ends in one", async () => {
    const fetch = stubFetch(() => jsonResponse(completionBody()));

    await provider(fetch, { baseUrl: `${BASE_URL}/` }).complete({
      messages: MESSAGES,
      maxOutputTokens: 10,
      signal: new AbortController().signal,
    });

    expect(fetch.calls[0].url).toBe(`${BASE_URL}/v1/chat/completions`);
  });

  it("sends no request when the signal is already aborted", async () => {
    const fetch = stubFetch(() => jsonResponse(completionBody()));
    const controller = new AbortController();
    controller.abort();

    await expect(complete(fetch, controller.signal)).resolves.toEqual({ ok: false, error: { kind: "timeout" } });
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("SoC adapter — success and usage (D-59, D-75)", () => {
  it("returns the content and usage of a 200 completion", async () => {
    await expect(complete(stubFetch(() => jsonResponse(completionBody())))).resolves.toEqual({
      ok: true,
      value: { content: '{"assessment":"x"}', usage: { inputTokens: 120, outputTokens: 40 } },
    });
  });

  it("ignores other fields, including a reasoning field", async () => {
    const body = completionBody({
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: "answer", reasoning_content: "hidden chain" },
        },
      ],
    });

    await expect(complete(stubFetch(() => jsonResponse(body)))).resolves.toEqual({
      ok: true,
      value: { content: "answer", usage: { inputTokens: 120, outputTokens: 40 } },
    });
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["not an object", "120"],
    ["missing completion_tokens", { prompt_tokens: 1 }],
    ["a string count", { prompt_tokens: "1", completion_tokens: 2 }],
    ["a negative count", { prompt_tokens: -1, completion_tokens: 2 }],
    ["a fractional count", { prompt_tokens: 1.5, completion_tokens: 2 }],
    ["a count above the integer range", { prompt_tokens: 2_147_483_648, completion_tokens: 2 }],
  ])("returns null usage when usage is %s", async (_label, usage) => {
    const result = await complete(stubFetch(() => jsonResponse(completionBody({ usage }))));

    expect(result).toEqual({ ok: true, value: { content: '{"assessment":"x"}', usage: null } });
  });

  it("accepts usage at the bounds of the integer range", async () => {
    const usage = { prompt_tokens: 0, completion_tokens: 2_147_483_647 };

    await expect(complete(stubFetch(() => jsonResponse(completionBody({ usage }))))).resolves.toEqual({
      ok: true,
      value: { content: '{"assessment":"x"}', usage: { inputTokens: 0, outputTokens: 2_147_483_647 } },
    });
  });

  it("returns an empty content string as a success for the caller's validate to judge", async () => {
    const body = completionBody({ choices: [{ finish_reason: "stop", message: { content: "" } }] });

    await expect(complete(stubFetch(() => jsonResponse(body)))).resolves.toMatchObject({ ok: true, value: { content: "" } });
  });
});

describe("SoC adapter — malformed responses (D-59, D-74, D-75)", () => {
  const MALFORMED = { ok: false, error: { kind: "malformed_response" } };

  it.each([
    ["a non-JSON body", () => new Response("<html>gateway</html>", { status: 200 })],
    ["an empty body", () => new Response("", { status: 200 })],
    ["a null body", () => new Response(null, { status: 200 })],
    ["a JSON array", () => jsonResponse([completionBody()])],
    ["a JSON string", () => jsonResponse("text")],
    ["missing choices", () => jsonResponse(completionBody({ choices: undefined }))],
    ["empty choices", () => jsonResponse(completionBody({ choices: [] }))],
    ["a null choice", () => jsonResponse(completionBody({ choices: [null] }))],
    ["a missing message", () => jsonResponse(completionBody({ choices: [{ finish_reason: "stop" }] }))],
    ["null content", () => jsonResponse(completionBody({ choices: [{ finish_reason: "stop", message: { content: null } }] }))],
    ["non-string content", () => jsonResponse(completionBody({ choices: [{ finish_reason: "stop", message: { content: 7 } }] }))],
    ["finish_reason length", () => jsonResponse(completionBody({ choices: [{ finish_reason: "length", message: { content: "x" } }] }))],
    ["no finish_reason", () => jsonResponse(completionBody({ choices: [{ message: { content: "x" } }] }))],
    ["a body over 1 MiB", () => new Response("x".repeat(1024 * 1024 + 1), { status: 200 })],
    ["status 201", () => jsonResponse(completionBody(), { status: 201 })],
    ["status 204", () => new Response(null, { status: 204 })],
    ["status 206", () => jsonResponse(completionBody(), { status: 206 })],
  ])("returns malformed_response for %s", async (_label, respond) => {
    await expect(complete(stubFetch(respond))).resolves.toEqual(MALFORMED);
  });

  it("accepts a body of exactly 1 MiB", async () => {
    const json = JSON.stringify(completionBody({ choices: [{ finish_reason: "stop", message: { content: "" } }] }));
    const padded = json + " ".repeat(1024 * 1024 - json.length);

    await expect(complete(stubFetch(() => new Response(padded, { status: 200 })))).resolves.toMatchObject({ ok: true });
  });

  it("stops reading a body once it passes 1 MiB", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(64 * 1024));
      },
    });

    await expect(complete(stubFetch(() => new Response(endless, { status: 200 })))).resolves.toEqual(MALFORMED);
    expect(pulls).toBeLessThan(20);
  });
});

describe("SoC adapter — HTTP status mapping (D-60, D-74)", () => {
  it.each([
    [400, "rejected"],
    [402, "rejected"],
    [409, "rejected"],
    [413, "rejected"],
    [422, "rejected"],
    [499, "rejected"],
    [401, "misconfigured"],
    [403, "misconfigured"],
    [404, "misconfigured"],
    [300, "misconfigured"],
    [301, "misconfigured"],
    [302, "misconfigured"],
    [307, "misconfigured"],
    [308, "misconfigured"],
    [408, "timeout"],
    [500, "unavailable"],
    [502, "unavailable"],
    [503, "unavailable"],
    [504, "unavailable"],
    [599, "unavailable"],
  ])("maps %i to %s", async (status, kind) => {
    const respond = () => new Response(JSON.stringify({ error: "gateway message" }), { status });

    await expect(complete(stubFetch(respond))).resolves.toEqual({ ok: false, error: { kind } });
  });

  it("maps an opaque redirect to misconfigured", async () => {
    const opaque = { type: "opaqueredirect", status: 0, headers: new Headers(), body: null } as unknown as Response;

    await expect(complete(stubFetch(() => opaque))).resolves.toEqual({ ok: false, error: { kind: "misconfigured" } });
  });

  it("maps a 1xx status to malformed_response", async () => {
    const informational = { type: "basic", status: 103, headers: new Headers(), body: null } as unknown as Response;

    await expect(complete(stubFetch(() => informational))).resolves.toEqual({
      ok: false,
      error: { kind: "malformed_response" },
    });
  });

  it.each([401, 429, 500])("discards a %i body without reading it", async (status) => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });

    await complete(stubFetch(() => new Response(body, { status })));

    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it.each<[string, () => Promise<Response>]>([
    ["a rejected promise", () => Promise.reject(new TypeError("fetch failed"))],
    ["a DNS-style error", () => Promise.reject(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }))],
    ["a synchronous throw", () => {
      throw new Error("boom");
    }],
  ])("maps a network failure (%s) to unavailable", async (_label, respond) => {
    await expect(complete(stubFetch(respond))).resolves.toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
  });

  it("maps a body stream error to unavailable", async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("socket hang up"));
      },
    });

    await expect(complete(stubFetch(() => new Response(broken, { status: 200 })))).resolves.toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
  });
});

describe("SoC adapter — Retry-After on 429 (D-60, D-75)", () => {
  function rateLimited(retryAfter: string | null) {
    const headers = retryAfter === null ? undefined : { "Retry-After": retryAfter };
    return complete(stubFetch(() => new Response('{"error":"rate limit"}', { status: 429, headers })));
  }

  it.each([
    ["30", 30],
    ["0", 0],
    [" 12 ", 12],
    ["007", 7],
    ["86400", 86_400],
    ["86401", 86_400],
    ["999999999999999999999", 86_400],
  ])("reads integer seconds %j as %d", async (value, seconds) => {
    await expect(rateLimited(value)).resolves.toEqual({
      ok: false,
      error: { kind: "rate_limited", retryAfterSeconds: seconds },
    });
  });

  it.each([
    ["absent", null],
    ["an HTTP date", "Wed, 21 Oct 2026 07:28:00 GMT"],
    ["negative", "-5"],
    ["fractional", "1.5"],
    ["empty", ""],
    ["text", "soon"],
    ["with a unit", "30s"],
  ])("gives null retryAfterSeconds when the header is %s", async (_label, value) => {
    await expect(rateLimited(value)).resolves.toEqual({
      ok: false,
      error: { kind: "rate_limited", retryAfterSeconds: null },
    });
  });
});

describe("SoC adapter — abort (D-60)", () => {
  it("returns timeout when the signal aborts while fetch is pending", async () => {
    const controller = new AbortController();
    const pending = complete(hangingFetch(), controller.signal);
    controller.abort();

    await expect(pending).resolves.toEqual({ ok: false, error: { kind: "timeout" } });
  });

  it("returns timeout when the signal aborts while the body is being read", async () => {
    const controller = new AbortController();
    const stalled = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"choices":'));
      },
    });
    const pending = complete(stubFetch(() => new Response(stalled, { status: 200 })), controller.signal);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(pending).resolves.toEqual({ ok: false, error: { kind: "timeout" } });
  });

  it("returns timeout when fetch rejects after the signal has aborted", async () => {
    const controller = new AbortController();
    const fetch: FetchFunction = async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    };

    await expect(complete(fetch, controller.signal)).resolves.toEqual({ ok: false, error: { kind: "timeout" } });
  });
});

describe("SoC adapter — containment (D-60, SEC-08)", () => {
  const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
  let spies: ReturnType<typeof vi.spyOn>[] = [];

  beforeEach(() => {
    spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  });
  afterEach(() => {
    for (const spy of spies) {
      spy.mockRestore();
    }
  });

  // Every provider body echoes the key and a provider message, so any leak would show in the result.
  const echo = `{"error":"invalid key ${API_KEY} at ${BASE_URL}"}`;
  const responders: [string, () => Response | Promise<Response>][] = [
    ["200 success", () => jsonResponse(completionBody({ choices: [{ finish_reason: "stop", message: { content: "ok" } }], note: API_KEY }))],
    ["200 non-JSON", () => new Response(`not json ${API_KEY}`, { status: 200 })],
    ["200 truncated", () => jsonResponse(completionBody({ choices: [{ finish_reason: "length", message: { content: "x" } }], note: API_KEY }))],
    ...[302, 400, 401, 403, 404, 408, 429, 500, 503].map(
      (status) =>
        [`status ${status}`, () => new Response(echo, { status, headers: { "Retry-After": "5", Location: `${BASE_URL}?k=${API_KEY}` } })] as [
          string,
          () => Response,
        ],
    ),
    ["network error", () => Promise.reject(new TypeError(`connect ECONNREFUSED ${BASE_URL} ${API_KEY}`))],
  ];

  it.each(responders)("keeps the key, URL and provider text out of the result and logs nothing (%s)", async (_label, respond) => {
    const result = await complete(stubFetch(respond));
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(BASE_URL);
    expect(serialized).not.toContain("invalid key");
    expect(serialized).not.toContain("ECONNREFUSED");
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("returns frozen failures, so a caller cannot change a later call's result", async () => {
    const fetch = stubFetch(() => new Response(echo, { status: 400 }));
    const first = await complete(fetch);

    expect(() => {
      (first as { error: { kind: string } }).error.kind = "changed";
    }).toThrow(TypeError);
    await expect(complete(fetch)).resolves.toEqual({ ok: false, error: { kind: "rejected" } });
  });
});
