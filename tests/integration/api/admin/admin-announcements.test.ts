import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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
const announcementsRoute = await import("../../../../src/app/api/v1/admin/announcements/route");
const announcementRoute = await import("../../../../src/app/api/v1/admin/announcements/[id]/route");
const composition = await import("../../../../src/server/composition");
const { connectAsOwner, insertMovie } = await import("../../database/schema-fixtures");

const ORIGIN = "http://localhost:3000";
const ADMIN_EMAIL = "announcements-admin@example.test";
const ADMIN_PASSWORD = "Admin-password1!";
const USER_EMAIL = "announcements-user@example.test";
const USER_PASSWORD = "User-password1!";

interface Credentials {
  readonly session: string;
  readonly csrfToken: string;
}

interface AnnouncementState {
  readonly title: string;
  readonly body: string;
  readonly movie_id: string | null;
  readonly state: string;
  readonly published_at: Date | null;
  readonly author_id: string;
  readonly version: number;
  readonly created_at: Date;
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
let adminId: string;

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
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD, displayName: "Announcements User" }),
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

function listAnnouncements(who: Credentials, query = ""): Promise<Response> {
  return announcementsRoute.GET(request(`/api/v1/admin/announcements${query}`, { headers: readHeaders(who) }));
}

function createAnnouncement(who: Credentials, body: unknown): Promise<Response> {
  return announcementsRoute.POST(request("/api/v1/admin/announcements", {
    method: "POST",
    headers: mutationHeaders(who, { "content-type": "application/json" }),
    body: JSON.stringify(body),
  }));
}

function getAnnouncement(who: Credentials, id: string): Promise<Response> {
  return announcementRoute.GET(request(`/api/v1/admin/announcements/${id}`, { headers: readHeaders(who) }), context(id));
}

function patchAnnouncement(who: Credentials, id: string, body: unknown, ifMatch: string | null): Promise<Response> {
  return announcementRoute.PATCH(request(`/api/v1/admin/announcements/${id}`, {
    method: "PATCH",
    headers: mutationHeaders(who, { "content-type": "application/json", ...(ifMatch === null ? {} : { "if-match": ifMatch }) }),
    body: JSON.stringify(body),
  }), context(id));
}

function deleteAnnouncement(who: Credentials, id: string, ifMatch: string | null): Promise<Response> {
  return announcementRoute.DELETE(request(`/api/v1/admin/announcements/${id}`, {
    method: "DELETE",
    headers: mutationHeaders(who, ifMatch === null ? {} : { "if-match": ifMatch }),
  }), context(id));
}

async function announcementState(id: string): Promise<AnnouncementState> {
  const { rows } = await owner.query<AnnouncementState>(
    `SELECT title, body, movie_id, state, published_at, author_id, version, created_at, updated_at
     FROM app.announcement WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("announcement not found");
  return row;
}

async function auditFor(targetId: string): Promise<AuditRow[]> {
  const { rows } = await owner.query<AuditRow>(
    `SELECT action, result, actor_id, before_after_metadata FROM app.audit_entry WHERE target_id = $1 ORDER BY created_at, id`,
    [targetId],
  );
  return rows;
}

async function announcementCount(): Promise<number> {
  const { rows } = await owner.query<{ count: number }>("SELECT count(*)::int AS count FROM app.announcement");
  return rows[0]?.count ?? 0;
}

async function createdAnnouncementId(body: unknown = { title: "Synthetic notice", body: "A synthetic body." }): Promise<string> {
  const response = await createAnnouncement(admin, body);
  expect(response.status).toBe(201);
  return (await response.json()).id as string;
}

/** Creates a draft and publishes it; returns its id at version 2. */
async function publishedAnnouncementId(): Promise<string> {
  const id = await createdAnnouncementId();
  expect((await patchAnnouncement(admin, id, { state: "published" }, '"1"')).status).toBe(200);
  return id;
}

async function errorBody(response: Response): Promise<{ code: string; fieldErrors?: Record<string, string[]> }> {
  return (await response.json()).error;
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
  const { rows } = await owner.query<{ id: string }>("SELECT id FROM app.account WHERE role = 'ADMIN'");
  adminId = rows[0]!.id;
});

afterAll(async () => {
  await owner.end();
});

describe("Admin Announcement API access (AT-06, D-81)", () => {
  it("rejects an anonymous list with 401", async () => {
    const response = await announcementsRoute.GET(request("/api/v1/admin/announcements"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a USER on every Admin Announcement endpoint with 403 and no mutation or audit", async () => {
    const id = await createdAnnouncementId();
    const before = await announcementState(id);
    const countBefore = await announcementCount();

    const responses = [
      await listAnnouncements(user),
      await getAnnouncement(user, id),
      await createAnnouncement(user, { title: "User notice", body: "Should never be stored." }),
      await patchAnnouncement(user, id, { state: "published" }, '"1"'),
      await deleteAnnouncement(user, id, '"1"'),
    ];

    for (const response of responses) {
      expect(response.status).toBe(403);
      expect((await errorBody(response)).code).toBe("forbidden");
    }
    expect(await announcementCount()).toBe(countBefore);
    expect(await announcementState(id)).toEqual(before);
    expect((await auditFor(id)).map((entry) => entry.action)).toEqual(["announcement.create"]);
  });

  it("rejects a mutation without a CSRF token or with a foreign Origin, before any write", async () => {
    const id = await createdAnnouncementId();
    const before = await announcementState(id);
    const countBefore = await announcementCount();

    const noTokenCreate = await announcementsRoute.POST(request("/api/v1/admin/announcements", {
      method: "POST",
      headers: { cookie: `fa_session=${admin.session}`, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ title: "No token", body: "Body." }),
    }));
    const noTokenDelete = await announcementRoute.DELETE(request(`/api/v1/admin/announcements/${id}`, {
      method: "DELETE",
      headers: { cookie: `fa_session=${admin.session}`, origin: ORIGIN, "if-match": '"1"' },
    }), context(id));
    const foreignOrigin = await announcementRoute.PATCH(request(`/api/v1/admin/announcements/${id}`, {
      method: "PATCH",
      headers: mutationHeaders(admin, { origin: "https://evil.example", "content-type": "application/json", "if-match": '"1"' }),
      body: JSON.stringify({ state: "published" }),
    }), context(id));

    for (const response of [noTokenCreate, noTokenDelete, foreignOrigin]) {
      expect(response.status).toBe(403);
      expect((await errorBody(response)).code).toBe("csrf_failed");
    }
    expect(await announcementCount()).toBe(countBefore);
    expect(await announcementState(id)).toEqual(before);
    expect(await auditFor(id)).toHaveLength(1);
  });
});

describe("POST /admin/announcements (D-79, D-80, D-81)", () => {
  it("creates a trimmed draft with no publication time: 201, ETag \"1\" and one applied audit without text", async () => {
    const response = await createAnnouncement(admin, { title: "  Opening night  ", body: " Doors open at seven. " });

    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    const announcement = await response.json();
    expect(Object.keys(announcement).sort()).toEqual(
      ["authorId", "body", "createdAt", "id", "movieId", "publishedAt", "state", "title", "updatedAt", "version"],
    );
    expect(announcement).toMatchObject({
      title: "Opening night",
      body: "Doors open at seven.",
      movieId: null,
      state: "draft",
      publishedAt: null,
      authorId: adminId,
      version: 1,
    });
    expect(new Date(announcement.createdAt).toISOString()).toBe(announcement.createdAt);

    const audit = await auditFor(announcement.id);
    expect(audit).toEqual([{
      action: "announcement.create",
      result: "applied",
      actor_id: adminId,
      before_after_metadata: { newVersion: 1, newState: "draft" },
    }]);
  });

  it("accepts an archived Movie as the reference", async () => {
    const movieId = await insertMovie(owner);
    await owner.query("UPDATE app.movie SET archived_at = now() WHERE id = $1", [movieId]);

    const response = await createAnnouncement(admin, { title: "Retrospective", body: "Body.", movieId });

    expect(response.status).toBe(201);
    expect((await response.json()).movieId).toBe(movieId);
  });

  it.each([
    ["a malformed", "not-a-uuid"],
    ["a nonexistent", "00000000-0000-4000-8000-000000000000"],
  ])("rejects %s movieId with 422 and a movieId field error, storing nothing", async (_label, movieId) => {
    const countBefore = await announcementCount();

    const response = await createAnnouncement(admin, { title: "T", body: "B", movieId });

    expect(response.status).toBe(422);
    const error = await errorBody(response);
    expect(error.code).toBe("validation_failed");
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(["movieId"]);
    expect(await announcementCount()).toBe(countBefore);
  });

  it.each([
    ["an empty title", { title: "  ", body: "B" }, "title"],
    ["an oversize title", { title: "t".repeat(201), body: "B" }, "title"],
    ["an empty body", { title: "T", body: "" }, "body"],
    ["an oversize body", { title: "T", body: "b".repeat(5_001) }, "body"],
    ["a client-supplied state", { title: "T", body: "B", state: "published" }, "state"],
    ["a client-supplied publishedAt", { title: "T", body: "B", publishedAt: "2026-10-20T00:00:00.000Z" }, "publishedAt"],
    ["a client-supplied authorId", { title: "T", body: "B", authorId: randomUUID() }, "authorId"],
  ])("rejects %s with 422 and no write", async (_label, body, field) => {
    const countBefore = await announcementCount();

    const response = await createAnnouncement(admin, body);

    expect(response.status).toBe(422);
    expect(Object.keys((await errorBody(response)).fieldErrors ?? {})).toEqual([field]);
    expect(await announcementCount()).toBe(countBefore);
  });

  it("stores markup as inert plain text and keeps it out of the audit entry", async () => {
    const markup = `<script>alert("x")</script><img src=x onerror=alert(1)>`;
    const id = await createdAnnouncementId({ title: markup, body: markup });

    expect(await announcementState(id)).toMatchObject({ title: markup, body: markup });
    expect(JSON.stringify(await auditFor(id))).not.toContain("script");
  });
});

describe("GET /admin/announcements and /admin/announcements/:id (D-80)", () => {
  it("returns 404 for a malformed or unknown id and 200 with ETag for an existing Announcement", async () => {
    const id = await createdAnnouncementId();

    expect((await getAnnouncement(admin, "not-a-uuid")).status).toBe(404);
    expect((await getAnnouncement(admin, randomUUID())).status).toBe(404);
    const response = await getAnnouncement(admin, id);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1"');
    expect((await response.json()).id).toBe(id);
  });

  it("includes drafts, published and deleted Announcements, ordered by updated_at DESC then id ASC across pages", async () => {
    const draft = await createdAnnouncementId();
    const published = await publishedAnnouncementId();
    const deleted = await createdAnnouncementId();
    expect((await deleteAnnouncement(admin, deleted, '"1"')).status).toBe(204);
    // Equal sort keys in the future put these first and exercise the ID tie-break.
    await owner.query(
      "UPDATE app.announcement SET updated_at = '2999-01-01T00:00:00Z' WHERE id = ANY($1::uuid[])",
      [[draft, published, deleted]],
    );
    const expected = [draft, published, deleted].sort();

    const seen: { id: string; state: string }[] = [];
    for (const page of [1, 2, 3]) {
      const response = await listAnnouncements(admin, `?page=${page}&pageSize=1`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.items).toHaveLength(1);
      seen.push({ id: body.items[0].id, state: body.items[0].state });
    }

    expect(seen.map((item) => item.id)).toEqual(expected);
    expect(new Set(seen.map((item) => item.state))).toEqual(new Set(["draft", "published", "deleted"]));
  });

  it("returns empty items with the actual total for a page beyond the end, and 422 for invalid paging", async () => {
    await createdAnnouncementId();
    const total = await announcementCount();

    const beyond = await listAnnouncements(admin, `?page=${total + 1}&pageSize=1`);
    expect(beyond.status).toBe(200);
    const body = await beyond.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(total);

    for (const query of ["?page=0", "?pageSize=101", "?pageSize=1.5"]) {
      expect((await listAnnouncements(admin, query)).status).toBe(422);
    }
  });
});

describe("PATCH /admin/announcements/:id (D-79, D-80, D-81)", () => {
  it("requires If-Match: absent → 428, malformed → 400, stale → 409 with no change or audit", async () => {
    const id = await createdAnnouncementId();
    const before = await announcementState(id);

    const absent = await patchAnnouncement(admin, id, { title: "Changed" }, null);
    const malformed = await patchAnnouncement(admin, id, { title: "Changed" }, 'W/"1"');
    const stale = await patchAnnouncement(admin, id, { title: "Changed" }, '"7"');

    expect(absent.status).toBe(428);
    expect(malformed.status).toBe(400);
    expect(stale.status).toBe(409);
    expect((await errorBody(stale)).code).toBe("stale_version");
    expect(await announcementState(id)).toEqual(before);
    expect(await auditFor(id)).toHaveLength(1);
  });

  it("returns 404 for a malformed or unknown path id", async () => {
    expect((await patchAnnouncement(admin, "not-a-uuid", { title: "T" }, '"1"')).status).toBe(404);
    expect((await patchAnnouncement(admin, randomUUID(), { title: "T" }, '"1"')).status).toBe(404);
  });

  it("rejects an empty object, an unknown field and state=deleted with 422 and no change", async () => {
    const id = await createdAnnouncementId();
    const before = await announcementState(id);

    const empty = await patchAnnouncement(admin, id, {}, '"1"');
    const unknown = await patchAnnouncement(admin, id, { title: "T", version: 9 }, '"1"');
    const deletedState = await patchAnnouncement(admin, id, { state: "deleted" }, '"1"');

    expect(empty.status).toBe(422);
    expect(Object.keys((await errorBody(empty)).fieldErrors ?? {})).toEqual(["request"]);
    expect(unknown.status).toBe(422);
    expect(deletedState.status).toBe(422);
    expect(await announcementState(id)).toEqual(before);
  });

  it("treats a normalized same-value PATCH as a 200 no-op with unchanged version/timestamps and a no_op audit", async () => {
    const id = await createdAnnouncementId({ title: "Same", body: "Same body." });
    const before = await announcementState(id);

    const response = await patchAnnouncement(admin, id, { title: "  Same ", body: "Same body.", movieId: null, state: "draft" }, '"1"');

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(await announcementState(id)).toEqual(before);
    expect((await auditFor(id)).at(-1)).toMatchObject({ action: "announcement.update", result: "no_op" });
  });

  it("runs the publication lifecycle: publish, edit while published, unpublish, publish again", async () => {
    const id = await createdAnnouncementId();

    const published = await patchAnnouncement(admin, id, { state: "published" }, '"1"');
    expect(published.status).toBe(200);
    expect(published.headers.get("etag")).toBe('"2"');
    const afterPublish = await announcementState(id);
    expect(afterPublish.state).toBe("published");
    expect(afterPublish.published_at).not.toBeNull();

    const edited = await patchAnnouncement(admin, id, { body: "Edited while published." }, '"2"');
    expect(edited.status).toBe(200);
    const afterEdit = await announcementState(id);
    expect(afterEdit).toMatchObject({ state: "published", body: "Edited while published.", version: 3 });
    expect(afterEdit.published_at).toEqual(afterPublish.published_at);

    const unpublished = await patchAnnouncement(admin, id, { state: "draft" }, '"3"');
    expect(unpublished.status).toBe(200);
    const afterUnpublish = await announcementState(id);
    expect(afterUnpublish.state).toBe("draft");
    expect(afterUnpublish.published_at).toEqual(afterPublish.published_at);

    const republished = await patchAnnouncement(admin, id, { state: "published" }, '"4"');
    expect(republished.status).toBe(200);
    const afterRepublish = await announcementState(id);
    expect(afterRepublish.state).toBe("published");
    expect(afterRepublish.published_at!.getTime()).toBeGreaterThan(afterPublish.published_at!.getTime());
    expect((await republished.json()).publishedAt).toBe(afterRepublish.published_at!.toISOString());

    expect((await auditFor(id)).map((entry) => `${entry.action}/${entry.result}`)).toEqual([
      "announcement.create/applied",
      "announcement.publish/applied",
      "announcement.update/applied",
      "announcement.unpublish/applied",
      "announcement.publish/applied",
    ]);
  });

  it("treats state=published on a published Announcement as update/no_op, and with a changed body as update/applied", async () => {
    const id = await publishedAnnouncementId();
    const before = await announcementState(id);

    const stateOnly = await patchAnnouncement(admin, id, { state: "published" }, '"2"');
    expect(stateOnly.status).toBe(200);
    expect(await announcementState(id)).toEqual(before);

    const withBody = await patchAnnouncement(admin, id, { state: "published", body: "Changed body." }, '"2"');
    expect(withBody.status).toBe(200);
    const after = await announcementState(id);
    expect(after.version).toBe(3);
    expect(after.published_at).toEqual(before.published_at);

    expect((await auditFor(id)).slice(-2).map((entry) => `${entry.action}/${entry.result}`)).toEqual([
      "announcement.update/no_op",
      "announcement.update/applied",
    ]);
  });

  it("publishes a draft with changed content once: one version, one publish audit with markers and no text", async () => {
    const id = await createdAnnouncementId();

    const response = await patchAnnouncement(admin, id, { title: "Secret headline", state: "published" }, '"1"');

    expect(response.status).toBe(200);
    expect((await announcementState(id)).version).toBe(2);
    const audit = await auditFor(id);
    expect(audit).toHaveLength(2);
    expect(audit[1]).toEqual({
      action: "announcement.publish",
      result: "applied",
      actor_id: adminId,
      before_after_metadata: {
        previousVersion: 1,
        newVersion: 2,
        previousState: "draft",
        newState: "published",
        titleChanged: true,
        stateChanged: true,
      },
    });
    expect(JSON.stringify(audit)).not.toContain("Secret headline");
  });

  it("sets, keeps and clears a Movie reference, including an archived Movie, without writing the Movie", async () => {
    const movieId = await insertMovie(owner);
    await owner.query("UPDATE app.movie SET archived_at = now() WHERE id = $1", [movieId]);
    const movieBefore = (await owner.query("SELECT * FROM app.movie WHERE id = $1", [movieId])).rows[0];
    const id = await createdAnnouncementId();

    const set = await patchAnnouncement(admin, id, { movieId }, '"1"');
    expect(set.status).toBe(200);
    expect((await set.json()).movieId).toBe(movieId);

    // Link eligibility tracks the Movie's state at read time; the Announcement itself is unaffected.
    await owner.query("UPDATE app.movie SET archived_at = NULL WHERE id = $1", [movieId]);
    const kept = await patchAnnouncement(admin, id, { title: "Retitled" }, '"2"');
    expect((await kept.json()).movieId).toBe(movieId);

    const cleared = await patchAnnouncement(admin, id, { movieId: null }, '"3"');
    expect((await cleared.json()).movieId).toBeNull();

    await owner.query("UPDATE app.movie SET archived_at = $2 WHERE id = $1", [movieId, movieBefore.archived_at]);
    expect((await owner.query("SELECT * FROM app.movie WHERE id = $1", [movieId])).rows[0]).toEqual(movieBefore);
  });

  it("rejects a nonexistent or malformed movieId with 422 and a movieId field error", async () => {
    const id = await createdAnnouncementId();
    const before = await announcementState(id);

    for (const movieId of ["00000000-0000-4000-8000-000000000000", "nope"]) {
      const response = await patchAnnouncement(admin, id, { movieId }, '"1"');
      expect(response.status).toBe(422);
      expect(Object.keys((await errorBody(response)).fieldErrors ?? {})).toEqual(["movieId"]);
    }
    expect(await announcementState(id)).toEqual(before);
  });

  it("rejects PATCH of a deleted Announcement: current version → 409 conflict, stale → 409 stale_version", async () => {
    const id = await publishedAnnouncementId();
    expect((await deleteAnnouncement(admin, id, '"2"')).status).toBe(204);
    const before = await announcementState(id);

    const current = await patchAnnouncement(admin, id, { state: "published", body: "Revived." }, '"3"');
    const stale = await patchAnnouncement(admin, id, { state: "published" }, '"2"');

    expect(current.status).toBe(409);
    expect((await errorBody(current)).code).toBe("conflict");
    expect(stale.status).toBe(409);
    expect((await errorBody(stale)).code).toBe("stale_version");
    expect(await announcementState(id)).toEqual(before);
    expect((await auditFor(id)).at(-1)?.action).toBe("announcement.delete");
  });
});

describe("DELETE /admin/announcements/:id (D-79, D-81)", () => {
  it("soft-deletes: 204, no body, new ETag, state deleted, published_at kept, one applied audit", async () => {
    const id = await publishedAnnouncementId();
    const before = await announcementState(id);

    const response = await deleteAnnouncement(admin, id, '"2"');

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBe('"3"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    const after = await announcementState(id);
    expect(after).toMatchObject({ state: "deleted", version: 3, title: before.title, body: before.body });
    expect(after.published_at).toEqual(before.published_at);
    expect((await auditFor(id)).at(-1)).toEqual({
      action: "announcement.delete",
      result: "applied",
      actor_id: adminId,
      before_after_metadata: { previousVersion: 2, newVersion: 3, previousState: "published", newState: "deleted" },
    });
  });

  it("repeats on a deleted Announcement as a 204 no-op: same ETag, nothing changed, no_op audit", async () => {
    const id = await createdAnnouncementId();
    expect((await deleteAnnouncement(admin, id, '"1"')).status).toBe(204);
    const before = await announcementState(id);

    const repeat = await deleteAnnouncement(admin, id, '"2"');

    expect(repeat.status).toBe(204);
    expect(repeat.headers.get("etag")).toBe('"2"');
    expect(await announcementState(id)).toEqual(before);
    expect((await auditFor(id)).at(-1)).toMatchObject({ action: "announcement.delete", result: "no_op" });
  });

  it("rejects a stale or absent If-Match even when the delete would be a no-op, with no write or audit", async () => {
    const id = await createdAnnouncementId();
    expect((await deleteAnnouncement(admin, id, '"1"')).status).toBe(204);
    const before = await announcementState(id);
    const auditBefore = await auditFor(id);

    const stale = await deleteAnnouncement(admin, id, '"1"');
    const absent = await deleteAnnouncement(admin, id, null);

    expect(stale.status).toBe(409);
    expect((await errorBody(stale)).code).toBe("stale_version");
    expect(absent.status).toBe(428);
    expect(await announcementState(id)).toEqual(before);
    expect(await auditFor(id)).toEqual(auditBefore);
  });

  it("returns 404 for a malformed or unknown id", async () => {
    expect((await deleteAnnouncement(admin, "not-a-uuid", '"1"')).status).toBe(404);
    expect((await deleteAnnouncement(admin, randomUUID(), '"1"')).status).toBe(404);
  });
});

describe("Admin Announcement atomicity (D-81)", () => {
  it("rolls back the publication and version together when the audit insert fails", async () => {
    const id = await createdAnnouncementId();
    const before = await announcementState(id);
    await owner.query(`
      CREATE FUNCTION app.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`);
    await owner.query(`CREATE TRIGGER test_fail_audit BEFORE INSERT ON app.audit_entry FOR EACH ROW EXECUTE FUNCTION app.test_fail_audit()`);
    try {
      const response = await patchAnnouncement(admin, id, { state: "published" }, '"1"');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("internal_error");
      expect(JSON.stringify(body)).not.toContain("synthetic audit failure");
      expect(await announcementState(id)).toEqual(before);
    } finally {
      await owner.query("DROP TRIGGER test_fail_audit ON app.audit_entry");
      await owner.query("DROP FUNCTION app.test_fail_audit()");
    }
  });
});
