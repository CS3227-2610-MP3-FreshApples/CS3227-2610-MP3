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
const { PATCH: patchReview } = await import("../../../../src/app/api/v1/reviews/[id]/route");
const { GET: getOwnReviews } = await import("../../../../src/app/api/v1/me/reviews/route");
const { connectAsOwner, insertMovie } = await import("../../database/schema-fixtures");

const ORIGIN = "http://localhost:3000";
function request(path: string, init?: RequestInit): Request { return new Request(`${ORIGIN}${path}`, init); }
function cookieValue(response: Response, name: string): string {
  const match = (response.headers.get("set-cookie") ?? "").match(new RegExp(`${name}=([^;]*)`));
  if (match?.[1] === undefined) throw new Error(`missing ${name}`);
  return match[1];
}
interface Credentials { readonly session: string; readonly csrfToken: string; }
async function signIn(email: string): Promise<Credentials> {
  const anonymous = await getCsrf(request("/api/v1/auth/csrf"));
  const pre = cookieValue(anonymous, "fa_presession");
  const csrf = (await anonymous.json()).csrfToken as string;
  const created = await register(request("/api/v1/auth/register", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `fa_presession=${pre}`, "x-csrf-token": csrf }, body: JSON.stringify({ email, password: "Review-password1!", displayName: "Review Author" }) }));
  expect(created.status).toBe(201);
  const loginCsrf = await getCsrf(request("/api/v1/auth/csrf"));
  const loginResponse = await login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `fa_presession=${cookieValue(loginCsrf, "fa_presession")}`, "x-csrf-token": (await loginCsrf.json()).csrfToken as string }, body: JSON.stringify({ email, password: "Review-password1!" }) }));
  const session = cookieValue(loginResponse, "fa_session");
  const bound = await getCsrf(request("/api/v1/auth/csrf", { headers: { cookie: `fa_session=${session}` } }));
  return { session, csrfToken: (await bound.json()).csrfToken as string };
}
function routeContext(id: string): { params: Promise<{ id: string }> } { return { params: Promise.resolve({ id }) }; }

describe("Review authorization and private listing", () => {
  let owner: Client;
  beforeAll(async () => { owner = await connectAsOwner(); });

  it("enforces ownership, CSRF, suspension, and /me/reviews privacy", async () => {
    const movieId = await insertMovie(owner);
    const firstEmail = `${randomUUID()}@example.test`;
    const secondEmail = `${randomUUID()}@example.test`;
    const first = await signIn(firstEmail);
    const second = await signIn(secondEmail);
    const created = await createReview(request(`/api/v1/movies/${movieId}/reviews`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `fa_session=${first.session}`, "x-csrf-token": first.csrfToken }, body: JSON.stringify({ rating: 8, body: "Private review body." }) }), routeContext(movieId));
    expect(created.status).toBe(201);
    const review = await created.json() as { id: string };

    const anonymous = await getOwnReviews(request("/api/v1/me/reviews"));
    expect(anonymous.status).toBe(401);
    const firstReviews = await getOwnReviews(request("/api/v1/me/reviews?page=1&pageSize=10", { headers: { cookie: `fa_session=${first.session}` } }));
    expect(firstReviews.status).toBe(200);
    expect(firstReviews.headers.get("cache-control")).toBe("no-store");
    expect((await firstReviews.json()).items).toHaveLength(1);
    const secondReviews = await getOwnReviews(request("/api/v1/me/reviews?page=1&pageSize=10", { headers: { cookie: `fa_session=${second.session}` } }));
    expect((await secondReviews.json()).items).toHaveLength(0);

    const author = await owner.query<{ id: string }>("SELECT id FROM app.account WHERE normalized_email = $1", [firstEmail]);
    const hiddenMovieId = await insertMovie(owner);
    const deletedMovieId = await insertMovie(owner);
    await owner.query(
      `INSERT INTO app.review (movie_id, author_id, rating, body, moderation_state, hidden_at, deleted_at, created_at, updated_at)
       VALUES ($1, $3, 9, 'Hidden review body.', 'cleared', now(), NULL, now(), now()),
              ($2, $3, 7, 'Deleted review body.', 'cleared', NULL, now(), now(), now())`,
      [hiddenMovieId, deletedMovieId, author.rows[0]!.id],
    );
    const visibleOwnReviews = await getOwnReviews(request("/api/v1/me/reviews?page=1&pageSize=10", { headers: { cookie: `fa_session=${first.session}` } }));
    expect(visibleOwnReviews.status).toBe(200);
    const visibleOwnBody = await visibleOwnReviews.json();
    expect(visibleOwnBody.items).toHaveLength(1);
    expect(visibleOwnBody.items[0].id).toBe(review.id);

    const wrongOwner = await patchReview(request(`/api/v1/reviews/${review.id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `fa_session=${second.session}`, "x-csrf-token": second.csrfToken, "if-match": '"1"' }, body: JSON.stringify({ rating: 7 }) }), routeContext(review.id));
    expect(wrongOwner.status).toBe(404);
    const csrfFailure = await patchReview(request(`/api/v1/reviews/${review.id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `fa_session=${first.session}`, "if-match": '"1"' }, body: JSON.stringify({ rating: 7 }) }), routeContext(review.id));
    expect(csrfFailure.status).toBe(403);

    await owner.query(`UPDATE app.account SET status = 'suspended' WHERE normalized_email = $1`, [firstEmail]);
    const suspended = await getOwnReviews(request("/api/v1/me/reviews", { headers: { cookie: `fa_session=${first.session}` } }));
    expect(suspended.status).toBe(403);
  });

  it("orders equal updated timestamps by Review ID", async () => {
    const email = `${randomUUID()}@example.test`;
    const credentials = await signIn(email);
    const movieId = await insertMovie(owner);
    const secondMovieId = await insertMovie(owner);
    const account = await owner.query<{ id: string }>("SELECT id FROM app.account WHERE normalized_email = $1", [email]);
    const authorId = account.rows[0]!.id;
    const earlierId = "00000000-0000-4000-8000-000000000001";
    const laterId = "00000000-0000-4000-8000-000000000002";
    await owner.query(
      `INSERT INTO app.review (id, movie_id, author_id, rating, body, moderation_state, created_at, updated_at)
       VALUES ($1, $3, $4, 7, 'Tie review one.', 'pending', '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z'),
              ($2, $5, $4, 8, 'Tie review two.', 'pending', '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`,
      [earlierId, laterId, movieId, authorId, secondMovieId],
    );

    const response = await getOwnReviews(request("/api/v1/me/reviews?page=1&pageSize=10", { headers: { cookie: `fa_session=${credentials.session}` } }));

    expect(response.status).toBe(200);
    expect((await response.json()).items.map((item: { id: string }) => item.id)).toEqual([earlierId, laterId]);
  });
});
