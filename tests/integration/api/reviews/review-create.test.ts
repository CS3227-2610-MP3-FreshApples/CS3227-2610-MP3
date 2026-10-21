import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { testDatabaseUrl } from "../../database/test-database";

process.env.APP_ENV = "test";
process.env.PUBLIC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = "synthetic-session-secret-012345678901234567890123456789";
process.env.RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-012345678901234567890123456789";
delete process.env.DATABASE_CA_CERT;

const { GET: getCsrf } = await import("../../../../src/app/api/v1/auth/csrf/route");
const { POST: register } = await import("../../../../src/app/api/v1/auth/register/route");
const { POST: login } = await import("../../../../src/app/api/v1/auth/login/route");
const { POST: createReview } = await import("../../../../src/app/api/v1/movies/[id]/reviews/route");
const { connectAsOwner, insertMovie } = await import("../../database/schema-fixtures");

const ORIGIN = "http://localhost:3000";

function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function cookieValue(response: Response, name: string): string {
  const match = (response.headers.get("set-cookie") ?? "").match(new RegExp(`${name}=([^;]*)`));
  if (match?.[1] === undefined || match[1] === "") throw new Error(`missing ${name} cookie`);
  return match[1];
}

interface Credentials {
  readonly session: string;
  readonly csrfToken: string;
}

async function registerAndSignIn(email: string): Promise<Credentials> {
  const anonymous = await getCsrf(request("/api/v1/auth/csrf"));
  const preSession = cookieValue(anonymous, "fa_presession");
  const registerResponse = await register(request("/api/v1/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_presession=${preSession}`,
      "x-csrf-token": (await anonymous.json()).csrfToken as string,
    },
    body: JSON.stringify({ email, password: "Review-password1!", displayName: "Review Author" }),
  }));
  expect(registerResponse.status).toBe(201);

  const loginCsrf = await getCsrf(request("/api/v1/auth/csrf"));
  const loginResponse = await login(request("/api/v1/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_presession=${cookieValue(loginCsrf, "fa_presession")}`,
      "x-csrf-token": (await loginCsrf.json()).csrfToken as string,
    },
    body: JSON.stringify({ email, password: "Review-password1!" }),
  }));
  expect(loginResponse.status).toBe(200);
  const session = cookieValue(loginResponse, "fa_session");
  const boundCsrf = await getCsrf(request("/api/v1/auth/csrf", { headers: { cookie: `fa_session=${session}` } }));
  return { session, csrfToken: (await boundCsrf.json()).csrfToken as string };
}

function context(movieId: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: movieId }) };
}

function postReview(credentials: Credentials, movieId: string, body: unknown): Promise<Response> {
  return createReview(request(`/api/v1/movies/${movieId}/reviews`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_session=${credentials.session}`,
      "x-csrf-token": credentials.csrfToken,
    },
    body: JSON.stringify(body),
  }), context(movieId));
}

describe("POST /api/v1/movies/:id/reviews — PostgreSQL journey", () => {
  let owner: Client;

  beforeAll(async () => {
    owner = await connectAsOwner();
  });

  it("creates pending work atomically and rejects a second active Review", async () => {
    const movieId = await insertMovie(owner);
    const credentials = await registerAndSignIn(`${randomUUID()}@example.test`);

    const response = await postReview(credentials, movieId, { rating: 8, body: "A useful review body." });
    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe('"1"');
    const saved = await response.json();
    expect(saved).toMatchObject({ movieId, rating: 8, body: "A useful review body.", moderationState: "pending", message: "Review saved and is pending moderation." });
    expect(saved).not.toHaveProperty("clearanceSource");
    expect(saved).not.toHaveProperty("author.email");

    const review = await owner.query<{ id: string; moderation_state: string; content_revision: number }>(
      `SELECT id, moderation_state, content_revision FROM app.review WHERE movie_id = $1`,
      [movieId],
    );
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0]).toMatchObject({ id: saved.id, moderation_state: "pending", content_revision: 1 });

    const work = await owner.query<{ status: string; content_revision: number }>(
      `SELECT status, content_revision FROM app.moderation_work WHERE review_id = $1`,
      [saved.id],
    );
    expect(work.rows).toEqual([{ status: "pending", content_revision: 1 }]);

    const movie = await owner.query<{ reviews_revision: number; summary_pending_since: Date | null }>(
      `SELECT reviews_revision, summary_pending_since FROM app.movie WHERE id = $1`,
      [movieId],
    );
    expect(movie.rows[0]).toMatchObject({ reviews_revision: 0, summary_pending_since: null });

    const duplicate = await postReview(credentials, movieId, { rating: 7, body: "Another useful body." });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe("conflict");
  });

  it("consumes mutation quota before rejecting malformed input", async () => {
    const movieId = await insertMovie(owner);
    const credentials = await registerAndSignIn(`${randomUUID()}@example.test`);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const invalid = await postReview(credentials, movieId, { rating: 99, body: "too short" });
      expect(invalid.status).toBe(422);
    }
    const limited = await postReview(credentials, movieId, { rating: 8, body: "A valid review body." });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
  });

  it("rejects archived Movies and serializes concurrent creates", async () => {
    const movieId = await insertMovie(owner);
    const credentials = await registerAndSignIn(`${randomUUID()}@example.test`);
    await owner.query(`UPDATE app.movie SET archived_at = now() WHERE id = $1`, [movieId]);
    const archived = await postReview(credentials, movieId, { rating: 8, body: "An archived movie body." });
    expect(archived.status).toBe(404);

    const activeMovieId = await insertMovie(owner);
    const first = postReview(credentials, activeMovieId, { rating: 8, body: "Concurrent review body." });
    const second = postReview(credentials, activeMovieId, { rating: 7, body: "Concurrent second body." });
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  });
});
