// TEMPORARY deployment smoke test (spec/tech-stack.md: "The SoC endpoint must be
// reachable from Vercel ... Verify this with a synthetic-data smoke test").
// Not part of the /api/v1 contract. Remove once reachability is recorded.
import { timingSafeEqual } from "node:crypto";

const TIMEOUT_MS = 15_000;

type ProbeResult = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error?: string;
};

function isAuthorised(request: Request): boolean {
  const expected = process.env.SMOKE_TEST_TOKEN;
  const header = request.headers.get("authorization") ?? "";
  if (!expected || !header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

// The SoC docs show both "$BASE/models" and "$BASE/v1/...", so accept a base URL
// with or without the trailing /v1.
function endpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}${path}` : `${base}/v1${path}`;
}

async function probe(url: string, init: RequestInit): Promise<ProbeResult & { body?: unknown }> {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = response.ok ? await response.json().catch(() => undefined) : undefined;
    return { ok: response.ok, status: response.status, latencyMs: Date.now() - started, body };
  } catch (error) {
    // Report only the error class (e.g. TimeoutError, TypeError for DNS/TLS/connect failures).
    const name = error instanceof Error ? error.name : "UnknownError";
    return { ok: false, status: null, latencyMs: Date.now() - started, error: name };
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorised(request)) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  const baseUrl = process.env.SOCLAAS_BASE_URL;
  const apiKey = process.env.SOCLAAS_API_KEY;
  const model = process.env.SOCLAAS_MODEL;
  if (!baseUrl || !apiKey || !model) {
    return Response.json({ error: "SOCLAAS_* environment variables not set" }, { status: 500 });
  }

  const auth = { Authorization: `Bearer ${apiKey}` };

  const models = await probe(endpoint(baseUrl, "/models"), { headers: auth });
  const modelIds = Array.isArray((models.body as { data?: unknown })?.data)
    ? (models.body as { data: { id?: unknown }[] }).data.map((m) => String(m.id))
    : [];

  const chat = await probe(endpoint(baseUrl, "/chat/completions"), {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
      max_tokens: 5,
    }),
  });
  const replied =
    typeof (chat.body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
      ?.message?.content === "string";

  return Response.json(
    {
      checkedAt: new Date().toISOString(),
      region: process.env.VERCEL_REGION ?? "local",
      models: { ok: models.ok, status: models.status, latencyMs: models.latencyMs, error: models.error, modelIds },
      configuredModelVisible: modelIds.includes(model),
      chat: { ok: chat.ok, status: chat.status, latencyMs: chat.latencyMs, error: chat.error, replied },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
