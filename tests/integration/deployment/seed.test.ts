import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { testDatabaseUrl } from "../database/test-database";
import { runSyntheticSeed, SYNTHETIC_MOVIES } from "../../../scripts/db-seed.mjs";

process.env.APP_ENV = "test";
process.env.PUBLIC_APP_URL = "http://127.0.0.1:3000";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = "synthetic-session-secret-012345678901234567890123456789";
process.env.RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-012345678901234567890123456789";
delete process.env.DATABASE_CA_CERT;
delete process.env.ADMIN_BOOTSTRAP_SECRET;
delete process.env.ADMIN_BOOTSTRAP_EMAIL;
delete process.env.ADMIN_BOOTSTRAP_PASSWORD;

const csrfRoute = await import("../../../src/app/api/v1/auth/csrf/route");
const loginRoute = await import("../../../src/app/api/v1/auth/login/route");
const logoutRoute = await import("../../../src/app/api/v1/auth/logout/route");
const movieRoute = await import("../../../src/app/api/v1/admin/movies/route");
const composition = await import("../../../src/server/composition");
const { connectAsOwner } = await import("../database/schema-fixtures");

const ORIGIN = "http://127.0.0.1:3000";
const ADMIN_EMAIL = "seed-integration-admin@example.test";
const ADMIN_PASSWORD = "Synthetic-seed-password1!";
const ENV = {
  APP_ENV: "test",
  PUBLIC_APP_URL: ORIGIN,
  SEED_ADMIN_EMAIL: ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
};

let owner: Client;

const routeFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const path = new URL(request.url).pathname;
  if (path === "/api/v1/auth/csrf" && request.method === "GET") return csrfRoute.GET(request);
  if (path === "/api/v1/auth/login" && request.method === "POST") return loginRoute.POST(request);
  if (path === "/api/v1/auth/logout" && request.method === "POST") return logoutRoute.POST(request);
  if (path === "/api/v1/admin/movies" && request.method === "GET") return movieRoute.GET(request);
  if (path === "/api/v1/admin/movies" && request.method === "POST") return movieRoute.POST(request);
  return new Response(null, { status: 404 });
};

async function run() {
  const output: string[] = [];
  const errors: string[] = [];
  const exitCode = await runSyntheticSeed({
    env: ENV,
    fetchImpl: routeFetch,
    writeOutput: (line: string) => output.push(line),
    writeError: (line: string) => errors.push(line),
  });
  return { exitCode, output, errors };
}

beforeAll(async () => {
  owner = await connectAsOwner();
  await composition.firstAdminBootstrapService!.bootstrap({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    requestId: randomUUID() as never,
  });
});

afterAll(async () => {
  await owner.end();
});

describe("DEP-04 synthetic seed through the real Catalogue API and PostgreSQL", () => {
  it("creates audited Movie rows once and skips the exact set on a sequential rerun", async () => {
    expect(await run()).toEqual({ exitCode: 0, output: ["movies_created=3 movies_existing=0"], errors: [] });
    expect(await run()).toEqual({ exitCode: 0, output: ["movies_created=0 movies_existing=3"], errors: [] });

    const movies = await owner.query<{
      title: string;
      synopsis: string;
      release_date: string | null;
      genres: string[];
      director: string;
      cast: string[];
      runtime_minutes: number | null;
      archived_at: Date | null;
    }>(`SELECT title, synopsis, release_date::text AS release_date, genres, director, "cast", runtime_minutes, archived_at
        FROM app.movie ORDER BY title`);
    expect(movies.rows).toEqual(
      [...SYNTHETIC_MOVIES]
        .sort((left, right) => left.title.localeCompare(right.title))
        .map((movie) => ({
          title: movie.title,
          synopsis: movie.synopsis,
          release_date: movie.releaseDate,
          genres: [...movie.genres],
          director: movie.director,
          cast: [...movie.cast],
          runtime_minutes: movie.runtimeMinutes,
          archived_at: null,
        })),
    );
    const audits = await owner.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM app.audit_entry WHERE action = 'movie.create'",
    );
    expect(audits.rows[0]?.count).toBe(3);
  });
});
