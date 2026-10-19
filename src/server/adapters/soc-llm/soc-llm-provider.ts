import "server-only";

import type { Result } from "../../shared";
import type { LlmCompletion, LlmFailure, LlmProvider, TokenUsage } from "./types";

/** The subset of `fetch` the adapter uses; the composition root passes the global one (D-78). */
export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

/** D-75: a 200 body longer than this is `malformed_response`. */
const MAX_RESPONSE_BYTES = 1024 * 1024;
/** D-75: larger `Retry-After` values are treated as this. */
const MAX_RETRY_AFTER_SECONDS = 86_400;
/** D-75: the range of the `integer` token columns. */
const MAX_TOKEN_COUNT = 2_147_483_647;

// Shared by every call, so frozen (D-23: no shared mutable state).
const failure = (kind: Exclude<LlmFailure["kind"], "rate_limited">): Result<LlmCompletion, LlmFailure> =>
  Object.freeze({ ok: false, error: Object.freeze({ kind }) });
const TIMEOUT = failure("timeout");
const UNAVAILABLE = failure("unavailable");
const REJECTED = failure("rejected");
const MISCONFIGURED = failure("misconfigured");
const MALFORMED = failure("malformed_response");

/**
 * K10 SoC LLM adapter (workflow/contracts.md §13; api.md 8.4). Sends one OpenAI-compatible chat completion
 * per call, with the body of D-59, and maps the outcome to an `LlmFailure` under D-60, D-74 and D-75.
 * The key is sent only in the Authorization header, redirects are not followed, error bodies are discarded
 * unread, and nothing is logged. The promise never rejects.
 */
export function createSocLlmProvider(deps: {
  /** HTTPS, without `/v1` (O-27); validated by the AI configuration. */
  readonly baseUrl: string;
  readonly apiKey: string;
  /** SOC_LLM_MODEL, the `default` alias in production (D-48). */
  readonly model: string;
  readonly fetch: FetchFunction;
}): LlmProvider {
  const url = `${deps.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const headers = {
    Authorization: `Bearer ${deps.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  return {
    modelId: deps.model,
    async complete({ messages, maxOutputTokens, signal }) {
      if (signal.aborted) {
        return TIMEOUT;
      }
      const body = JSON.stringify({
        model: deps.model,
        messages: messages.map(({ role, content }) => ({ role, content })),
        max_tokens: maxOutputTokens,
        stream: false,
        reasoning_effort: "none",
      });

      let response: Response;
      try {
        response = await deps.fetch(url, { method: "POST", headers, body, signal, redirect: "manual" });
      } catch {
        return signal.aborted ? TIMEOUT : UNAVAILABLE;
      }

      if (response.status !== 200) {
        discardBody(response);
        return failureForStatus(response);
      }
      try {
        return await readCompletion(response, signal);
      } catch {
        return signal.aborted ? TIMEOUT : UNAVAILABLE;
      }
    },
  };
}

function failureForStatus(response: Response): Result<LlmCompletion, LlmFailure> {
  const { status } = response;
  if (response.type === "opaqueredirect" || (status >= 300 && status < 400)) {
    return MISCONFIGURED;
  }
  if (status === 429) {
    return { ok: false, error: { kind: "rate_limited", retryAfterSeconds: retryAfterSeconds(response.headers) } };
  }
  if (status === 408) {
    return TIMEOUT;
  }
  if (status === 401 || status === 403 || status === 404) {
    return MISCONFIGURED;
  }
  if (status >= 400 && status < 500) {
    return REJECTED;
  }
  if (status >= 500) {
    return UNAVAILABLE;
  }
  // 1xx, or 2xx other than 200 (D-74).
  return MALFORMED;
}

/** D-60, D-75: non-negative integer seconds only, capped; the HTTP-date form and anything else give null. */
function retryAfterSeconds(headers: Headers): number | null {
  const value = headers.get("retry-after")?.trim();
  if (value === undefined || !/^\d+$/.test(value)) {
    return null;
  }
  return Math.min(Number(value), MAX_RETRY_AFTER_SECONDS);
}

/** D-75: error bodies are never read. Cancelling releases the connection; a failure to cancel is ignored. */
function discardBody(response: Response): void {
  response.body?.cancel().catch(() => {});
}

async function readCompletion(response: Response, signal: AbortSignal): Promise<Result<LlmCompletion, LlmFailure>> {
  if (response.body === null) {
    return MALFORMED;
  }
  const bytes = await readBounded(response.body, signal);
  if (signal.aborted) {
    return TIMEOUT;
  }
  if (bytes === null) {
    return MALFORMED;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return MALFORMED;
  }
  return parseCompletion(parsed);
}

/**
 * Reads at most MAX_RESPONSE_BYTES. Returns null when the body is longer. An abort cancels the read, so the
 * caller sees `signal.aborted` even when the fetch implementation does not error the stream itself.
 */
async function readBounded(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) {
    onAbort();
  }
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** D-59: success needs `choices[0].message.content` as a string and `finish_reason` `stop`. Other fields are ignored. */
function parseCompletion(parsed: unknown): Result<LlmCompletion, LlmFailure> {
  if (!isRecord(parsed) || !Array.isArray(parsed.choices) || parsed.choices.length === 0) {
    return MALFORMED;
  }
  const choice: unknown = parsed.choices[0];
  if (!isRecord(choice) || choice.finish_reason !== "stop" || !isRecord(choice.message)) {
    return MALFORMED;
  }
  const content = choice.message.content;
  if (typeof content !== "string") {
    return MALFORMED;
  }
  return { ok: true, value: { content, usage: parseUsage(parsed.usage) } };
}

/** D-59, D-75: both counts must be integers from 0 to MAX_TOKEN_COUNT; otherwise usage is unknown. */
function parseUsage(usage: unknown): TokenUsage | null {
  if (!isRecord(usage) || !isTokenCount(usage.prompt_tokens) || !isTokenCount(usage.completion_tokens)) {
    return null;
  }
  return { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens };
}

function isTokenCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_TOKEN_COUNT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
