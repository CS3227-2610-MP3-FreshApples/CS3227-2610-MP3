import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// K8 `lockReviewsOfMovie` is Developer A's (U-02) and is not on `master` yet. Until it is, the composition
// root leaves the archive/restore orchestrator unwired, so these tests wire it with the PostgreSQL-backed
// stand-in from tests/support/fakes/review-locks.ts. Every other dependency is the real composition.
vi.mock("../../../../src/server/composition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/server/composition")>();
  const { createMovieArchiveService } = await import("../../../../src/server/services/catalogue-archive");
  const { createAdminMovieRepository } = await import("../../../../src/server/repositories/catalogue");
  const { createPostgresReviewsOfMovieLockStandIn } = await import("../../../support/fakes/review-locks");
  const database = actual.database!;
  const reviewLocksStandIn = createPostgresReviewsOfMovieLockStandIn(database);
  return {
    ...actual,
    reviewLocksStandIn,
    movieArchiveService: createMovieArchiveService({
      database,
      movies: createAdminMovieRepository({ sql: database }),
      movieLocks: actual.movieLocks!,
      reviewLocks: reviewLocksStandIn,
      marker: actual.reviewsChangedMarker!,
      auditLog: actual.auditLog!,
    }),
  };
});

import { testDatabaseUrl } from "../../database/test-database";

process.env.APP_ENV = "test";
process.env.PUBLIC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = "synthetic-session-secret-012345678901234567890123456789";
process.env.RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-012345678901234567890123456789";
delete process.env.DATABASE_CA_CERT;
delete process.env.ADMIN_BOOTSTRAP_SECRET;
delete process.env.ADMIN_BOOTSTRAP_EMAIL;
delete process.env.ADMIN_BOOTSTRAP_PASSWORD;

const { GET: getCsrf } = await import("../../../../src/app/api/v1/auth/csrf/route");
const { POST: register } = await import("../../../../src/app/api/v1/auth/register/route");
const { POST: login } = await import("../../../../src/app/api/v1/auth/login/route");
const moviesRoute = await import("../../../../src/app/api/v1/admin/movies/route");
const movieRoute = await import("../../../../src/app/api/v1/admin/movies/[id]/route");
const restoreRoute = await import("../../../../src/app/api/v1/admin/movies/[id]/restore/route");
const composition = await import("../../../../src/server/composition");
const { connectAsOwner, insertAccount, insertMovie, insertReview } = await import("../../database/schema-fixtures");
import type { RecordingReviewsOfMovieLock } from "../../../support/fakes/review-locks";

const reviewLocksStandIn = (composition as unknown as { reviewLocksStandIn: RecordingReviewsOfMovieLock }).reviewLocksStandIn;

const ORIGIN = "http://localhost:3000";
const ADMIN_EMAIL = "movies-admin@example.test";
const ADMIN_PASSWORD = "Admin-password1!";
const USER_EMAIL = "movies-user@example.test";
const USER_PASSWORD = "User-password1!";

interface Credentials {
  readonly session: string;
  readonly csrfToken: string;
}

interface MovieState {
  readonly title: string;
  readonly version: number;
  readonly archived_at: Date | null;
  readonly reviews_revision: number;
  readonly summary_pending_since: Date | null;
  readonly updated_at: Date;
}

interface AuditRow {
  readonly action: string;
  readonly result: string;
  readonly actor_id: string | null;
  readonly before_after_metadata: Record<string, unknown>;
}

let owner: Client;
let admin: Credentials;
let user: Credentials;

function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function cookieValue(response: Response, name: string): string {
  const match = (response.headers.get("set-cookie") ?? "").match(new RegExp(`${name}=([^;]*)`));
  if (match?.[1] === undefined || match[1] === "") throw new Error(`missing ${name} cookie`);
  return match[1];
}

async function signIn(email: string, password: string): Promise<Credentials> {
  const anonymous = await getCsrf(request("/api/v1/auth/csrf"));
  const preSession = cookieValue(anonymous, "fa_presession");
  const loginResponse = await login(request("/api/v1/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_presession=${preSession}`,
      "x-csrf-token": (await anonymous.json()).csrfToken as string,
    },
    body: JSON.stringify({ email, password }),
  }));
  expect(loginResponse.status).toBe(200);
  const session = cookieValue(loginResponse, "fa_session");
  const bound = await getCsrf(request("/api/v1/auth/csrf", { headers: { cookie: `fa_session=${session}` } }));
  return { session, csrfToken: (await bound.json()).csrfToken as string };
}

async function registerUser(): Promise<void> {
  const anonymous = await getCsrf(request("/api/v1/auth/csrf"));
  const response = await register(request("/api/v1/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `fa_presession=${cookieValue(anonymous, "fa_presession")}`,
      "x-csrf-token": (await anonymous.json()).csrfToken as string,
    },
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD, displayName: "Movies User" }),
  }));
  expect(response.status).toBe(201);
}

function readHeaders(who: Credentials): HeadersInit {
  return { cookie: `fa_session=${who.session}` };
}

function mutationHeaders(who: Credentials, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: `fa_session=${who.session}`, origin: ORIGIN, "x-csrf-token": who.csrfToken, ...extra };
}

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function listMovies(who: Credentials, query = ""): Promise<Response> {
  return moviesRoute.GET(request(`/api/v1/admin/movies${query}`, { headers: readHeaders(who) }));
}

function createMovie(who: Credentials, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
  return moviesRoute.POST(request("/api/v1/admin/movies", {
    method: "POST",
    headers: mutationHeaders(who, { "content-type": "application/json", ...extra }),
    body: JSON.stringify(body),
  }));
}

function getMovie(who: Credentials, id: string): Promise<Response> {
  return movieRoute.GET(request(`/api/v1/admin/movies/${id}`, { headers: readHeaders(who) }), context(id));
}

function patchMovie(who: Credentials, id: string, body: unknown, ifMatch: string | null): Promise<Response> {
  return movieRoute.PATCH(request(`/api/v1/admin/movies/${id}`, {
    method: "PATCH",
    headers: mutationHeaders(who, { "content-type": "application/json", ...(ifMatch === null ? {} : { "if-match": ifMatch }) }),
    body: JSON.stringify(body),
  }), context(id));
}

function archiveMovie(who: Credentials, id: string, ifMatch: string | null): Promise<Response> {
  return movieRoute.DELETE(request(`/api/v1/admin/movies/${id}`, {
    method: "DELETE",
    headers: mutationHeaders(who, ifMatch === null ? {} : { "if-match": ifMatch }),
  }), context(id));
}

function restoreMovie(who: Credentials, id: string, ifMatch: string | null): Promise<Response> {
  return restoreRoute.POST(request(`/api/v1/admin/movies/${id}/restore`, {
    method: "POST",
    headers: mutationHeaders(who, ifMatch === null ? {} : { "if-match": ifMatch }),
  }), context(id));
}

async function movieState(id: string): Promise<MovieState> {
  const { rows } = await owner.query<MovieState>(
    `SELECT title, version, archived_at, reviews_revision, summary_pending_since, updated_at FROM app.movie WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("movie not found");
  return row;
}

async function auditFor(targetId: string): Promise<AuditRow[]> {
  const { rows } = await owner.query<AuditRow>(
    `SELECT action, result, actor_id, before_after_metadata FROM app.audit_entry WHERE target_id = $1 ORDER BY created_at, id`,
    [targetId],
  );
  return rows;
}

async function movieCount(): Promise<number> {
  const { rows } = await owner.query<{ count: number }>("SELECT count(*)::int AS count FROM app.movie");
  return rows[0]?.count ?? 0;
}

async function createdMovieId(body: unknown = { title: "Synthetic Film", synopsis: "A synthetic synopsis." }): Promise<string> {
  const response = await createMovie(admin, body);
  expect(response.status).toBe(201);
  return (await response.json()).id as string;
}

async function errorCode(response: Response): Promise<string> {
  return (await response.json()).error.code as string;
}

beforeAll(async () => {
  owner = await connectAsOwner();
  await composition.firstAdminBootstrapService!.bootstrap({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    requestId: randomUUID() as never,
  });
  await registerUser();
  admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  user = await signIn(USER_EMAIL, USER_PASSWORD);
});

afterAll(async () => {
  await owner.end();
});

beforeEach(() => {
  reviewLocksStandIn.calls.length = 0;
});

describe("Admin Movie API access (AT-02, D-81)", () => {
  it("rejects an anonymous list with 401", async () => {
    const response = await moviesRoute.GET(request("/api/v1/admin/movies"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a USER on every Admin Movie endpoint with 403 and no mutation or audit", async () => {
    const movieId = await insertMovie(owner);
    const before = await movieState(movieId);
    const countBefore = await movieCount();

    const responses = [
      await listMovies(user),
      await getMovie(user, movieId),
      await createMovie(user, { title: "User Film", synopsis: "Should never be stored." }),
      await patchMovie(user, movieId, { title: "Hijacked" }, `"${before.version}"`),
      await archiveMovie(user, movieId, `"${before.version}"`),
      await restoreMovie(user, movieId, `"${before.version}"`),
    ];

    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("forbidden");
    }
    expect(await movieCount()).toBe(countBefore);
    expect(await movieState(movieId)).toEqual(before);
    expect(await auditFor(movieId)).toEqual([]);
    expect(reviewLocksStandIn.calls).toEqual([]);
  });

  it("rejects an Admin mutation without a CSRF token or with a foreign Origin, before any write", async () => {
    const movieId = await insertMovie(owner);
    const before = await movieState(movieId);

    const noToken = await movieRoute.DELETE(request(`/api/v1/admin/movies/${movieId}`, {
      method: "DELETE",
      headers: { cookie: `fa_session=${admin.session}`, origin: ORIGIN, "if-match": `"${before.version}"` },
    }), context(movieId));
    const foreignOrigin = await movieRoute.PATCH(request(`/api/v1/admin/movies/${movieId}`, {
      method: "PATCH",
      headers: mutationHeaders(admin, { origin: "https://evil.example", "content-type": "application/json", "if-match": `"${before.version}"` }),
      body: JSON.stringify({ title: "Cross-site" }),
    }), context(movieId));

    expect(noToken.status).toBe(403);
    expect(await errorCode(noToken)).toBe("csrf_failed");
    expect(foreignOrigin.status).toBe(403);
    expect(await errorCode(foreignOrigin)).toBe("csrf_failed");
    expect(await movieState(movieId)).toEqual(before);
    expect(await auditFor(movieId)).toEqual([]);
  });
});

describe("POST /admin/movies (D-80, D-81)", () => {
  it("creates a Movie with defaults for omitted optional fields, 201, ETag and one applied audit", async () => {
    const response = await createMovie(admin, { title: "  Trimmed Title  ", synopsis: " Synopsis. " });

    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe('"1"');
    const movie = await response.json();
    expect(movie).toMatchObject({
      title: "Trimmed Title",
      synopsis: "Synopsis.",
      releaseDate: null,
      genres: [],
      director: "",
      cast: [],
      runtimeMinutes: null,
      archivedAt: null,
      version: 1,
    });
    expect(Object.keys(movie).sort()).toEqual([
      "archivedAt", "cast", "createdAt", "director", "genres", "id", "releaseDate", "runtimeMinutes",
      "synopsis", "title", "updatedAt", "version",
    ]);
    expect(movie.createdAt).toMatch(/Z$/);
    const audit = await auditFor(movie.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "movie.create", result: "applied" });
    expect(JSON.stringify(audit[0]!.before_after_metadata)).not.toContain("Trimmed Title");
  });

  it("stores every writable field, keeping array order", async () => {
    const response = await createMovie(admin, {
      title: "Full Film",
      synopsis: "Full synopsis.",
      releaseDate: "2024-02-29",
      genres: [" Drama ", "Comedy", "Drama"],
      director: " A Director ",
      cast: ["Zed", "Amy"],
      runtimeMinutes: 1000,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      releaseDate: "2024-02-29",
      genres: ["Drama", "Comedy", "Drama"],
      director: "A Director",
      cast: ["Zed", "Amy"],
      runtimeMinutes: 1000,
    });
  });

  it.each([
    ["an unknown field", { title: "T", synopsis: "S", poster: "x.png" }, "poster"],
    ["a derived version", { title: "T", synopsis: "S", version: 7 }, "version"],
    ["a derived archive state", { title: "T", synopsis: "S", archivedAt: null }, "archivedAt"],
    ["a derived reviews revision", { title: "T", synopsis: "S", reviewsRevision: 3 }, "reviewsRevision"],
    ["an actor field", { title: "T", synopsis: "S", actorId: randomUUID() }, "actorId"],
    ["a client id", { id: randomUUID(), title: "T", synopsis: "S" }, "id"],
    ["a null director", { title: "T", synopsis: "S", director: null }, "director"],
    ["a null genres array", { title: "T", synopsis: "S", genres: null }, "genres"],
    ["an impossible releaseDate", { title: "T", synopsis: "S", releaseDate: "2023-02-29" }, "releaseDate"],
    ["a timestamp releaseDate", { title: "T", synopsis: "S", releaseDate: "2023-02-01T00:00:00Z" }, "releaseDate"],
    ["a whitespace-only title", { title: "   ", synopsis: "S" }, "title"],
    ["a missing synopsis", { title: "T" }, "synopsis"],
    ["an oversized title", { title: "x".repeat(201), synopsis: "S" }, "title"],
    ["a fractional runtime", { title: "T", synopsis: "S", runtimeMinutes: 90.5 }, "runtimeMinutes"],
    ["eleven genres", { title: "T", synopsis: "S", genres: Array.from({ length: 11 }, (_, i) => `g${i}`) }, "genres"],
  ])("rejects %s with 422 and no Movie", async (_case, body, field) => {
    const countBefore = await movieCount();
    const response = await createMovie(admin, body);

    expect(response.status).toBe(422);
    const error = (await response.json()).error;
    expect(error.code).toBe("validation_failed");
    expect(Object.keys(error.fieldErrors)).toContain(field);
    expect(await movieCount()).toBe(countBefore);
  });

  it("returns 415 for a non-JSON body", async () => {
    const response = await moviesRoute.POST(request("/api/v1/admin/movies", {
      method: "POST",
      headers: mutationHeaders(admin, { "content-type": "text/plain" }),
      body: "title=x",
    }));
    expect(response.status).toBe(415);
  });
});

describe("GET /admin/movies and /admin/movies/:id (D-80)", () => {
  it("returns 404 for a malformed or unknown id and 200 with ETag for an existing Movie", async () => {
    const id = await createdMovieId();
    expect((await getMovie(admin, "not-a-uuid")).status).toBe(404);
    expect((await getMovie(admin, randomUUID())).status).toBe(404);
    const found = await getMovie(admin, id);
    expect(found.status).toBe(200);
    expect(found.headers.get("etag")).toBe('"1"');
    expect((await found.json()).id).toBe(id);
  });

  it("includes archived Movies and orders by updated_at DESC then id ASC across pages", async () => {
    await owner.query("TRUNCATE app.audit_entry, app.review, app.movie CASCADE");
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await insertMovie(owner));
    await owner.query("UPDATE app.movie SET updated_at = '2026-01-01T00:00:00Z'");
    await owner.query("UPDATE app.movie SET updated_at = '2026-02-01T00:00:00Z', archived_at = now() WHERE id = $1", [ids[4]]);
    const tied = ids.slice(0, 4).sort();

    const first = await listMovies(admin, "?page=1&pageSize=2");
    const second = await listMovies(admin, "?page=2&pageSize=2");
    const third = await listMovies(admin, "?page=3&pageSize=2");

    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ page: 1, pageSize: 2, total: 5 });
    const order = [
      ...firstBody.items.map((item: { id: string }) => item.id),
      ...(await second.json()).items.map((item: { id: string }) => item.id),
      ...(await third.json()).items.map((item: { id: string }) => item.id),
    ];
    expect(order).toEqual([ids[4], ...tied]);
    expect(firstBody.items[0].archivedAt).not.toBeNull();
  });

  it("returns empty items with the actual total for a page beyond the end", async () => {
    const response = await listMovies(admin, "?page=999&pageSize=100");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(await movieCount());
  });

  it.each(["?page=0", "?pageSize=101", "?page=1.5", "?pageSize=-1", "?page=abc"])(
    "rejects %s with 422, not clamping",
    async (query) => {
      const response = await listMovies(admin, query);
      expect(response.status).toBe(422);
      expect(await errorCode(response)).toBe("validation_failed");
    },
  );
});

describe("PATCH /admin/movies/:id (D-79, D-80, D-81)", () => {
  it("requires If-Match: absent → 428, malformed → 400, stale → 409 with no change or audit", async () => {
    const id = await createdMovieId();
    const before = await movieState(id);

    const absent = await patchMovie(admin, id, { title: "New" }, null);
    const weak = await patchMovie(admin, id, { title: "New" }, 'W/"1"');
    const star = await patchMovie(admin, id, { title: "New" }, "*");
    const stale = await patchMovie(admin, id, { title: "New" }, '"9"');

    expect(absent.status).toBe(428);
    expect(await errorCode(absent)).toBe("precondition_required");
    expect(weak.status).toBe(400);
    expect(star.status).toBe(400);
    expect(stale.status).toBe(409);
    expect(await errorCode(stale)).toBe("stale_version");
    expect(await movieState(id)).toEqual(before);
    expect((await auditFor(id)).map((entry) => entry.action)).toEqual(["movie.create"]);
  });

  it("rejects an empty object and an unknown field with 422 and no change", async () => {
    const id = await createdMovieId();
    const before = await movieState(id);

    const empty = await patchMovie(admin, id, {}, '"1"');
    const unknown = await patchMovie(admin, id, { title: "New", summaryPendingSince: null }, '"1"');

    expect(empty.status).toBe(422);
    expect(unknown.status).toBe(422);
    expect(Object.keys((await unknown.json()).error.fieldErrors)).toEqual(["summaryPendingSince"]);
    expect(await movieState(id)).toEqual(before);
  });

  it("applies a change once: version +1, new ETag, reviews_revision unchanged, audit names fields only", async () => {
    const id = await createdMovieId();
    const before = await movieState(id);

    const response = await patchMovie(admin, id, { title: "Renamed Film", runtimeMinutes: 95 }, '"1"');

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"2"');
    expect(await response.json()).toMatchObject({ title: "Renamed Film", runtimeMinutes: 95, synopsis: "A synthetic synopsis.", version: 2 });
    const after = await movieState(id);
    expect(after.version).toBe(2);
    expect(after.reviews_revision).toBe(before.reviews_revision);
    expect(after.summary_pending_since).toBeNull();
    const update = (await auditFor(id))[1]!;
    expect(update).toMatchObject({ action: "movie.update", result: "applied" });
    expect(update.before_after_metadata).toEqual({ previousVersion: 1, newVersion: 2, titleChanged: true, runtimeMinutesChanged: true });
  });

  it("treats a normalized same-value PATCH as a 200 no-op with unchanged version/timestamps and a no_op audit", async () => {
    const id = await createdMovieId({ title: "Same Film", synopsis: "Same.", genres: ["A", "B"] });
    const before = await movieState(id);

    const response = await patchMovie(admin, id, { title: "  Same Film ", genres: [" A", "B "] }, '"1"');

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(await movieState(id)).toEqual(before);
    expect((await auditFor(id))[1]).toMatchObject({ action: "movie.update", result: "no_op" });
  });

  it("treats a reordered array as a change", async () => {
    const id = await createdMovieId({ title: "Order Film", synopsis: "S.", cast: ["A", "B"] });
    const response = await patchMovie(admin, id, { cast: ["B", "A"] }, '"1"');
    expect(response.headers.get("etag")).toBe('"2"');
  });

  it("clears optional fields with null, [] and a blank director, and retains omitted ones", async () => {
    const id = await createdMovieId({
      title: "Clear Film", synopsis: "S.", releaseDate: "2001-01-01", genres: ["G"], director: "D", cast: ["C"], runtimeMinutes: 100,
    });

    const response = await patchMovie(admin, id, { releaseDate: null, genres: [], director: "   ", runtimeMinutes: null }, '"1"');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      title: "Clear Film", releaseDate: null, genres: [], director: "", cast: ["C"], runtimeMinutes: null, version: 2,
    });
  });

  it("allows metadata edits of an archived Movie without restoring it", async () => {
    const id = await createdMovieId();
    expect((await archiveMovie(admin, id, '"1"')).status).toBe(204);

    const response = await patchMovie(admin, id, { synopsis: "Edited while archived." }, '"2"');

    expect(response.status).toBe(200);
    expect((await response.json()).archivedAt).not.toBeNull();
    expect((await movieState(id)).archived_at).not.toBeNull();
  });

  it("returns 404 for an unknown Movie", async () => {
    const response = await patchMovie(admin, randomUUID(), { title: "Ghost" }, '"1"');
    expect(response.status).toBe(404);
  });
});

describe("DELETE /admin/movies/:id — archive (D-79, D-81, P-12)", () => {
  it("archives: 204, no body, new ETag, archived_at set (hidden from public reads), revision and pending marker advanced", async () => {
    const id = await createdMovieId();
    const before = await movieState(id);

    const response = await archiveMovie(admin, id, '"1"');

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBe('"2"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const after = await movieState(id);
    // U-01's public GET /movies is not on this branch; it filters on archived_at IS NULL, so assert the column.
    expect(after.archived_at).not.toBeNull();
    expect(after.version).toBe(2);
    expect(after.reviews_revision).toBe(before.reviews_revision + 1);
    expect(after.summary_pending_since).not.toBeNull();
    expect(reviewLocksStandIn.calls).toEqual([id]);
    const archive = (await auditFor(id))[1]!;
    expect(archive).toMatchObject({ action: "movie.archive", result: "applied" });
    expect(archive.before_after_metadata).toEqual({ previousVersion: 1, newVersion: 2, archivedBefore: false, archivedAfter: true });
  });

  it("repeats on an archived Movie as a 204 no-op: same ETag, nothing changed, no Review locks, no_op audit", async () => {
    const id = await createdMovieId();
    await archiveMovie(admin, id, '"1"');
    const before = await movieState(id);
    reviewLocksStandIn.calls.length = 0;

    const response = await archiveMovie(admin, id, '"2"');

    expect(response.status).toBe(204);
    expect(response.headers.get("etag")).toBe('"2"');
    expect(await movieState(id)).toEqual(before);
    expect(reviewLocksStandIn.calls).toEqual([]);
    expect((await auditFor(id))[2]).toMatchObject({ action: "movie.archive", result: "no_op" });
  });

  it("rejects a stale or absent If-Match even when the archive would be a no-op, with no write or audit", async () => {
    const id = await createdMovieId();
    await archiveMovie(admin, id, '"1"');
    const before = await movieState(id);

    const stale = await archiveMovie(admin, id, '"1"');
    const absent = await archiveMovie(admin, id, null);

    expect(stale.status).toBe(409);
    expect(await errorCode(stale)).toBe("stale_version");
    expect(absent.status).toBe(428);
    expect(await movieState(id)).toEqual(before);
    expect(await auditFor(id)).toHaveLength(2);
  });

  it("returns 404 for a malformed or unknown Movie id", async () => {
    expect((await archiveMovie(admin, "123", '"1"')).status).toBe(404);
    expect((await archiveMovie(admin, randomUUID(), '"1"')).status).toBe(404);
  });

  it("keeps every Review row and flag unchanged across archive and restore", async () => {
    const id = await createdMovieId();
    const author = await insertAccount(owner);
    const reviewId = await insertReview(owner, id, author);
    await owner.query("UPDATE app.review SET hidden_at = now(), moderation_state = 'flagged' WHERE id = $1", [reviewId]);
    const { rows: [reviewBefore] } = await owner.query("SELECT * FROM app.review WHERE id = $1", [reviewId]);

    expect((await archiveMovie(admin, id, '"1"')).status).toBe(204);
    expect((await restoreMovie(admin, id, '"2"')).status).toBe(200);

    const { rows: [reviewAfter] } = await owner.query("SELECT * FROM app.review WHERE id = $1", [reviewId]);
    expect(reviewAfter).toEqual(reviewBefore);
    expect(reviewLocksStandIn.calls).toEqual([id, id]);
  });

  it("rolls back the archive, version and review marker together when the audit insert fails", async () => {
    const id = await createdMovieId();
    const before = await movieState(id);
    await owner.query(`
      CREATE FUNCTION app.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`);
    await owner.query(`CREATE TRIGGER test_fail_audit BEFORE INSERT ON app.audit_entry FOR EACH ROW EXECUTE FUNCTION app.test_fail_audit()`);
    try {
      const response = await archiveMovie(admin, id, '"1"');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("internal_error");
      expect(JSON.stringify(body)).not.toContain("synthetic audit failure");
      expect(await movieState(id)).toEqual(before);
    } finally {
      await owner.query("DROP TRIGGER test_fail_audit ON app.audit_entry");
      await owner.query("DROP FUNCTION app.test_fail_audit()");
    }
  });
});

describe("POST /admin/movies/:id/restore (D-79, D-81, P-12)", () => {
  it("restores: 200 Movie with new version/ETag, reviews_revision bumped and summary marked pending", async () => {
    const id = await createdMovieId();
    await archiveMovie(admin, id, '"1"');
    // Simulate a published summary since the archive, so restore must set the pending marker again.
    await owner.query("UPDATE app.movie SET summary_pending_since = NULL WHERE id = $1", [id]);
    const before = await movieState(id);

    const response = await restoreMovie(admin, id, '"2"');

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"3"');
    expect(await response.json()).toMatchObject({ id, archivedAt: null, version: 3 });
    const after = await movieState(id);
    expect(after.archived_at).toBeNull();
    expect(after.reviews_revision).toBe(before.reviews_revision + 1);
    expect(after.summary_pending_since).not.toBeNull();
    const restore = (await auditFor(id))[2]!;
    expect(restore).toMatchObject({ action: "movie.restore", result: "applied" });
    expect(restore.before_after_metadata).toEqual({ previousVersion: 2, newVersion: 3, archivedBefore: true, archivedAfter: false });
  });

  it("preserves the oldest pending time across archive and restore", async () => {
    const id = await createdMovieId();
    await archiveMovie(admin, id, '"1"');
    const pendingSince = (await movieState(id)).summary_pending_since;

    await restoreMovie(admin, id, '"2"');

    expect((await movieState(id)).summary_pending_since).toEqual(pendingSince);
  });

  it("repeats on an active Movie as a 200 no-op: unchanged version, revision and markers, no_op audit", async () => {
    const id = await createdMovieId();
    const before = await movieState(id);

    const response = await restoreMovie(admin, id, '"1"');

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1"');
    expect((await response.json()).version).toBe(1);
    expect(await movieState(id)).toEqual(before);
    expect(reviewLocksStandIn.calls).toEqual([]);
    expect((await auditFor(id))[1]).toMatchObject({ action: "movie.restore", result: "no_op" });
  });

  it("rejects a stale If-Match with 409 and leaves the Movie archived", async () => {
    const id = await createdMovieId();
    await archiveMovie(admin, id, '"1"');
    const before = await movieState(id);

    const response = await restoreMovie(admin, id, '"1"');

    expect(response.status).toBe(409);
    expect(await movieState(id)).toEqual(before);
    expect(await auditFor(id)).toHaveLength(2);
  });
});
