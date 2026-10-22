import { describe, expect, it, vi } from "vitest";

import { runSyntheticSeed, SYNTHETIC_MOVIES } from "../../../scripts/db-seed.mjs";

const ENV = {
  APP_ENV: "test",
  PUBLIC_APP_URL: "http://127.0.0.1:3000",
  SEED_ADMIN_EMAIL: "seed-admin@example.test",
  SEED_ADMIN_PASSWORD: "Synthetic-seed-password1!",
};

function json(body: unknown, status = 200, cookie?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(cookie === undefined ? {} : { "set-cookie": cookie }) },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function api(existing: readonly unknown[] = []) {
  const created: unknown[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/auth/csrf" && init?.headers === undefined) {
      return json({ csrfToken: "anonymous-csrf" }, 200, "fa_presession=synthetic-pre; Path=/; HttpOnly");
    }
    if (url.pathname === "/api/v1/auth/login") {
      return json({ role: "ADMIN", status: "active" }, 200, "fa_session=synthetic-session; Path=/; HttpOnly");
    }
    if (url.pathname === "/api/v1/auth/csrf") return json({ csrfToken: "bound-csrf" });
    if (url.pathname === "/api/v1/admin/movies" && init?.method !== "POST") {
      return json({ items: existing, total: existing.length, page: 1, pageSize: 100 });
    }
    if (url.pathname === "/api/v1/admin/movies" && init?.method === "POST") {
      const movie = JSON.parse(String(init.body));
      created.push(movie);
      return json({ id: "00000000-0000-4000-8000-000000000001", ...movie, archivedAt: null }, 201);
    }
    if (url.pathname === "/api/v1/auth/logout") return noContent();
    return json({ error: { code: "not_found" } }, 404);
  });
  return { fetchImpl, created };
}

async function run(fetchImpl: typeof fetch, env: Record<string, string | undefined> = ENV) {
  const output: string[] = [];
  const errors: string[] = [];
  const exitCode = await runSyntheticSeed({
    env,
    fetchImpl,
    writeOutput: (line: string) => output.push(line),
    writeError: (line: string) => errors.push(line),
  });
  return { exitCode, output, errors };
}

describe("DEP-04 synthetic Movie seed", () => {
  it("creates the three fixed synthetic Movies through the authenticated Admin API", async () => {
    const fake = api();

    const result = await run(fake.fetchImpl as typeof fetch);

    expect(result).toEqual({ exitCode: 0, output: ["movies_created=3 movies_existing=0"], errors: [] });
    expect(fake.created).toEqual(SYNTHETIC_MOVIES);
    expect(fake.fetchImpl.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/api/v1/auth/csrf",
      "/api/v1/auth/login",
      "/api/v1/auth/csrf",
      "/api/v1/admin/movies",
      "/api/v1/admin/movies",
      "/api/v1/admin/movies",
      "/api/v1/admin/movies",
      "/api/v1/auth/logout",
    ]);
    const mutationCalls = fake.fetchImpl.mock.calls.filter(([input, init]) =>
      new URL(String(input)).pathname === "/api/v1/admin/movies" && init?.method === "POST");
    expect(mutationCalls).toHaveLength(3);
    for (const [, init] of mutationCalls) {
      expect(init?.headers).toMatchObject({
        cookie: "fa_session=synthetic-session",
        origin: ENV.PUBLIC_APP_URL,
        "x-csrf-token": "bound-csrf",
      });
    }
  });

  it("skips exact existing synthetic Movies on a sequential rerun", async () => {
    const existing = SYNTHETIC_MOVIES.map((movie, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 1}`,
      ...movie,
      archivedAt: null,
    }));
    const fake = api(existing);

    expect(await run(fake.fetchImpl as typeof fetch)).toEqual({
      exitCode: 0,
      output: ["movies_created=0 movies_existing=3"],
      errors: [],
    });
    expect(fake.created).toEqual([]);
  });

  it("refuses a title collision instead of changing unrelated data", async () => {
    const fake = api([{ ...SYNTHETIC_MOVIES[0], synopsis: "Different existing Movie.", archivedAt: null }]);

    expect(await run(fake.fetchImpl as typeof fetch)).toEqual({
      exitCode: 1,
      output: [],
      errors: ["db:seed failed"],
    });
    expect(fake.created).toEqual([]);
    expect(fake.fetchImpl.mock.calls.at(-1)?.[0].toString()).toContain("/api/v1/auth/logout");
  });

  it.each([
    ["production", { ...ENV, APP_ENV: "production" }],
    ["development", { ...ENV, APP_ENV: "development" }],
    ["missing environment", { APP_ENV: "test" }],
    ["non-loopback target", { ...ENV, PUBLIC_APP_URL: "https://preview.example.test" }],
    ["target with a path", { ...ENV, PUBLIC_APP_URL: "http://localhost:3000/app" }],
  ])("fails closed before fetching for %s", async (_label, env) => {
    const fetchImpl = vi.fn();

    expect(await run(fetchImpl as typeof fetch, env)).toEqual({
      exitCode: 1,
      output: [],
      errors: ["db:seed failed"],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires an active Admin principal", async () => {
    const fake = api();
    fake.fetchImpl.mockImplementationOnce(async () => json({ csrfToken: "anonymous-csrf" }, 200, "fa_presession=pre; Path=/"));
    fake.fetchImpl.mockImplementationOnce(async () => json({ role: "USER", status: "active" }, 200, "fa_session=session; Path=/"));

    expect(await run(fake.fetchImpl as typeof fetch)).toEqual({
      exitCode: 1,
      output: [],
      errors: ["db:seed failed"],
    });
  });

  it("never prints a thrown response detail or seed credential", async () => {
    const secret = ENV.SEED_ADMIN_PASSWORD;
    const fetchImpl = vi.fn(async () => { throw new Error(`synthetic failure ${secret}`); });
    const result = await run(fetchImpl as typeof fetch);

    expect(result).toEqual({ exitCode: 1, output: [], errors: ["db:seed failed"] });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
