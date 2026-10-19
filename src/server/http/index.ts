import "server-only";

export {
  clientIpFromVercelHeaders,
  placeholderClientIp,
  type ClientIpResolver,
} from "./client-ip";

import { ServiceUnavailableError, TransactionConflict } from "../shared/errors";
import type { Brand, DomainError, FieldErrors, RequestId, Result, RowVersion } from "../shared/types";

const MAX_JSON_BODY_BYTES = 32 * 1024;

export type Validator<T> = (input: unknown) => Result<T, FieldErrors>;

export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

type ErrorDetails = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
};

const ERROR_DETAILS: Record<DomainError["kind"], ErrorDetails> = {
  malformed: { status: 400, code: "malformed_request", message: "The request is malformed." },
  unauthenticated: { status: 401, code: "unauthenticated", message: "Authentication is required." },
  forbidden: { status: 403, code: "forbidden", message: "The request is not permitted." },
  csrf_failed: { status: 403, code: "csrf_failed", message: "The request failed CSRF validation." },
  not_found: { status: 404, code: "not_found", message: "The requested resource was not found." },
  conflict: { status: 409, code: "conflict", message: "The request conflicts with the current state." },
  stale_version: { status: 409, code: "stale_version", message: "The resource version is stale." },
  payload_too_large: { status: 413, code: "payload_too_large", message: "The request body is too large." },
  unsupported_media_type: { status: 415, code: "unsupported_media_type", message: "The media type is not supported." },
  invalid_fields: { status: 422, code: "validation_failed", message: "One or more fields are invalid." },
  precondition_required: { status: 428, code: "precondition_required", message: "If-Match is required." },
  rate_limited: { status: 429, code: "rate_limited", message: "Too many requests." },
  unavailable: { status: 503, code: "service_unavailable", message: "The service is temporarily unavailable." },
};

function newRequestId(): RequestId {
  return crypto.randomUUID() as RequestId;
}

function responseWithHeaders(response: Response, requestId: RequestId): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Request-Id", requestId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function runRoute(
  handler: (request: Request, requestId: RequestId) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = newRequestId();
    // Preserve NextRequest's runtime implementation. Reconstructing it with the
    // global Request constructor crosses Undici/Next.js private-field brands in
    // a production bundle and fails before the Route Handler runs.
    const routedRequest = request.clone();
    routedRequest.headers.set("X-Request-Id", requestId);

    try {
      return responseWithHeaders(await handler(routedRequest, requestId), requestId);
    } catch (error) {
      if (error instanceof TransactionConflict) return errorResponse({ kind: "conflict" }, requestId);
      if (error instanceof ServiceUnavailableError) return errorResponse({ kind: "unavailable" }, requestId);
      return responseWithHeaders(internalErrorResponse(requestId), requestId);
    }
  };
}

export async function readJsonBody<T>(request: Request, validate: Validator<T>): Promise<Result<T, DomainError>> {
  const contentType = request.headers.get("Content-Type");
  if (contentType === null || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return { ok: false, error: { kind: "unsupported_media_type" } };
  }

  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && Number(declaredLength) > MAX_JSON_BODY_BYTES) {
    return { ok: false, error: { kind: "payload_too_large" } };
  }

  let bytes: ArrayBuffer | null;
  try {
    bytes = await readBoundedBody(request);
  } catch {
    return { ok: false, error: { kind: "malformed" } };
  }

  if (bytes === null) {
    return { ok: false, error: { kind: "payload_too_large" } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, error: { kind: "malformed" } };
  }

  const validated = validate(parsed);
  return validated.ok
    ? validated
    : { ok: false, error: { kind: "invalid_fields", fieldErrors: validated.error } };
}

async function readBoundedBody(request: Request): Promise<ArrayBuffer | null> {
  if (request.body === null) {
    return new ArrayBuffer(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalLength += value.byteLength;
      if (totalLength > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export function trimmedCodePointLength(text: string): number {
  return Array.from(text.trim()).length;
}

export function readPageRequest(url: URL): Result<PageRequest, DomainError> {
  const fieldErrors: Record<string, readonly string[]> = {};
  const page = parsePageValue(url.searchParams.get("page"), 1);
  const pageSize = parsePageValue(url.searchParams.get("pageSize"), 20, 100);

  if (page === null || pageSize === null) {
    if (page === null) {
      fieldErrors.page = ["must be a positive integer"];
    }
    if (pageSize === null) {
      fieldErrors.pageSize = ["must be an integer from 1 to 100"];
    }
    return { ok: false, error: { kind: "invalid_fields", fieldErrors } };
  }

  return { ok: true, value: { page, pageSize } };
}

function parsePageValue(raw: string | null, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (raw === null) {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum ? value : null;
}

export function parseId<B extends string>(raw: string): Result<Brand<string, B>, DomainError> {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(raw)
    ? { ok: true, value: raw as Brand<string, B> }
    : { ok: false, error: { kind: "not_found" } };
}

export function readIfMatch(request: Request): Result<RowVersion, DomainError> {
  const raw = request.headers.get("If-Match");
  if (raw === null) {
    return { ok: false, error: { kind: "precondition_required" } };
  }
  if (!/^"\d+"$/.test(raw)) {
    return { ok: false, error: { kind: "malformed" } };
  }

  const value = Number(raw.slice(1, -1));
  return Number.isSafeInteger(value)
    ? { ok: true, value: value as RowVersion }
    : { ok: false, error: { kind: "malformed" } };
}

function internalErrorResponse(requestId: RequestId): Response {
  const body = {
    error: {
      code: "internal_error",
      message: "An unexpected server error occurred.",
      requestId,
    },
  };

  const response = jsonBodyResponse(500, body);
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export function errorResponse(error: DomainError, requestId: RequestId): Response {
  const details = ERROR_DETAILS[error.kind];
  const errorBody: {
    code: string;
    message: string;
    fieldErrors?: FieldErrors;
    requestId: RequestId;
  } = {
    code: details.code,
    message: details.message,
    requestId,
  };

  if (error.kind === "invalid_fields") {
    errorBody.fieldErrors = error.fieldErrors;
  }

  const response = jsonBodyResponse(details.status, { error: errorBody });
  response.headers.set("X-Request-Id", requestId);
  if (error.kind === "rate_limited") {
    response.headers.set("Retry-After", String(error.retryAfterSeconds));
  }
  return response;
}

export function jsonResponse(status: 200 | 201 | 202, body: unknown): Response {
  return jsonBodyResponse(status, body);
}

function jsonBodyResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function versionedJsonResponse(status: 200 | 201, body: unknown, version: RowVersion): Response {
  const response = jsonResponse(status, body);
  response.headers.set("ETag", `"${version}"`);
  return response;
}

export function listResponse<T>(page: PageRequest, items: readonly T[], total: number): Response {
  return jsonResponse(200, { items, page: page.page, pageSize: page.pageSize, total });
}

export function noContentResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
