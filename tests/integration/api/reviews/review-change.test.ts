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
const { GET: getMovie } = await import("../../../../src/app/api/v1/movies/[id]/route");
const { PATCH: patchReview, DELETE: deleteReview } = await import("../../../../src/app/api/v1/reviews/[id]/route");
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
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: `fa_presession=${preSession}`, "x-csrf-token": (await anonymous.json()).csrfToken as string },
    body: JSON.stringify({ email, password: "Review-password1!", displayName: "Review Author" }),
  }));
  expect(registerResponse.status).toBe(201);

  const loginCsrf = await getCsrf(request("/api/v1/auth/csrf"));
  const loginResponse = await login(request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: `fa_presession=${cookieValue(loginCsrf, "fa_presession")}`, "x-csrf-token": (await loginCsrf.json()).csrfToken as string },
    body: JSON.stringify({ email, password: "Review-password1!" }),
  }));
  expect(loginResponse.status).toBe(200);
  const session = cookieValue(loginResponse, "fa_session");
  const boundCsrf = await getCsrf(request("/api/v1/auth/csrf", { headers: { cookie: `fa_session=${session}` } }));
  return { session, csrfToken: (await boundCsrf.json()).csrfToken as string };
}

function context(reviewId: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: reviewId }) };
}

function mutationRequest(credentials: Credentials, path: string, method: string, body: unknown, etag?: string): Request {
  return request(path, {
    method,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_session=${credentials.session}`,
      "x-csrf-token": credentials.csrfToken,
      ...(etag === undefined ? {} : { "if-match": etag }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Review edit and delete lifecycle — PostgreSQL journey", () => {
  let owner: Client;

  beforeAll(async () => {
    owner = await connectAsOwner();
  });

  it("retains rating-only clearance, resets body edits, preserves hidden state, and reuses identity after delete", async () => {
    const movieId = await insertMovie(owner);
    const credentials = await registerAndSignIn(`${randomUUID()}@example.test`);
    const created = await createReview(
      mutationRequest(credentials, `/api/v1/movies/${movieId}/reviews`, "POST", { rating: 5, body: "Original review body." }),
      { params: Promise.resolve({ id: movieId }) },
    );
    expect(created.status).toBe(201);
    const initial = await created.json() as { id: string };
    const initialVersion = created.headers.get("etag") ?? '"1"';

    await owner.query(`UPDATE app.review SET moderation_state = 'cleared', clearance_source = 'ai' WHERE id = $1`, [initial.id]);
    const ratingOnly = await patchReview(
      mutationRequest(credentials, `/api/v1/reviews/${initial.id}`, "PATCH", { rating: 8 }, initialVersion),
      context(initial.id),
    );
    expect(ratingOnly.status).toBe(200);
    expect(ratingOnly.headers.get("etag")).toBe('"2"');
    expect(await ratingOnly.json()).toMatchObject({ rating: 8, body: "Original review body.", moderationState: "cleared", message: "Review saved." });
    const retained = await owner.query<{ content_revision: number; clearance_source: string; moderation_state: string; version: number }>(
      `SELECT content_revision, clearance_source, moderation_state, version FROM app.review WHERE id = $1`, [initial.id],
    );
    expect(retained.rows[0]).toMatchObject({ content_revision: 1, clearance_source: "ai", moderation_state: "cleared", version: 2 });
    const afterRating = await owner.query<{ reviews_revision: number }>(`SELECT reviews_revision FROM app.movie WHERE id = $1`, [movieId]);
    expect(afterRating.rows[0]?.reviews_revision).toBe(1);

    const bodyEdit = await patchReview(
      mutationRequest(credentials, `/api/v1/reviews/${initial.id}`, "PATCH", { body: "Changed review body." }, '"2"'),
      context(initial.id),
    );
    expect(bodyEdit.status).toBe(200);
    expect(bodyEdit.headers.get("etag")).toBe('"3"');
    expect(await bodyEdit.json()).toMatchObject({ body: "Changed review body.", moderationState: "pending", message: "Review saved and is pending moderation." });
    const afterBody = await owner.query<{ reviews_revision: number }>(`SELECT reviews_revision FROM app.movie WHERE id = $1`, [movieId]);
    expect(afterBody.rows[0]?.reviews_revision).toBe(2);
    const publicMovie = await getMovie(new Request(`http://localhost:3000/api/v1/movies/${movieId}`), { params: Promise.resolve({ id: movieId }) });
    expect(publicMovie.status).toBe(200);
    expect(await publicMovie.json()).toMatchObject({ averageRating: null, reviewCount: 0 });

    await owner.query(`UPDATE app.review SET hidden_at = now() WHERE id = $1`, [initial.id]);
    const hiddenEdit = await patchReview(
      mutationRequest(credentials, `/api/v1/reviews/${initial.id}`, "PATCH", { body: "Hidden review changed." }, '"3"'),
      context(initial.id),
    );
    expect(hiddenEdit.status).toBe(200);
    expect(hiddenEdit.headers.get("etag")).toBe('"4"');
    const hidden = await owner.query<{ hidden_at: Date | null; deleted_at: Date | null; moderation_state: string }>(
      `SELECT hidden_at, deleted_at, moderation_state FROM app.review WHERE id = $1`, [initial.id],
    );
    expect(hidden.rows[0]?.hidden_at).not.toBeNull();
    expect(hidden.rows[0]).toMatchObject({ deleted_at: null, moderation_state: "pending" });

    // Model an Admin restore before exercising author deletion/resubmission; the author edit above never clears hidden_at.
    await owner.query(`UPDATE app.review SET hidden_at = NULL WHERE id = $1`, [initial.id]);

    const deleted = await deleteReview(
      mutationRequest(credentials, `/api/v1/reviews/${initial.id}`, "DELETE", undefined, '"4"'),
      context(initial.id),
    );
    expect(deleted.status).toBe(204);
    expect(deleted.headers.get("etag")).toBe('"5"');
    expect(await deleted.text()).toBe("");

    const resubmitted = await createReview(
      mutationRequest(credentials, `/api/v1/movies/${movieId}/reviews`, "POST", { rating: 9, body: "Resubmitted review body." }),
      { params: Promise.resolve({ id: movieId }) },
    );
    expect(resubmitted.status).toBe(201);
    const replacement = await resubmitted.json();
    expect(replacement).toMatchObject({ id: initial.id, rating: 9, body: "Resubmitted review body.", moderationState: "pending" });
    const final = await owner.query<{ deleted_at: Date | null; hidden_at: Date | null; content_revision: number; version: number }>(
      `SELECT deleted_at, hidden_at, content_revision, version FROM app.review WHERE id = $1`, [initial.id],
    );
    expect(final.rows[0]).toMatchObject({ deleted_at: null, content_revision: 4, version: 6 });
  });

  it("rejects a stale edit without changing the Review", async () => {
    const movieId = await insertMovie(owner);
    const credentials = await registerAndSignIn(`${randomUUID()}@example.test`);
    const created = await createReview(
      mutationRequest(credentials, `/api/v1/movies/${movieId}/reviews`, "POST", { rating: 4, body: "A stale version body." }),
      { params: Promise.resolve({ id: movieId }) },
    );
    const review = await created.json() as { id: string };
    const stale = await patchReview(
      mutationRequest(credentials, `/api/v1/reviews/${review.id}`, "PATCH", { rating: 6 }, '"999"'),
      context(review.id),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("stale_version");
  });
});
