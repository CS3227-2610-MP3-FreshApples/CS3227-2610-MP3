import { describe, expect, it } from "vitest";
import type { Fetcher } from "../../../src/app/admin/_lib/admin-http";
import { createAnnouncement, updateAnnouncement } from "../../../src/app/admin/_lib/announcement-client";
import { archiveMovie, createMovie, restoreMovie, updateMovie } from "../../../src/app/admin/_lib/movie-client";
import { updateUserStatus } from "../../../src/app/admin/_lib/user-client";

const movie = { id: "movie-1", title: "New title", synopsis: "New synopsis", director: "Director", genres: ["Drama", "Comedy"], cast: ["Actor"], releaseDate: null, runtimeMinutes: null, archivedAt: null, version: 4, createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T01:00:00Z" };
const announcement = { id: "notice-1", title: "New title", body: "New body", movieId: null, state: "published", publishedAt: "2026-10-22T01:00:00Z", authorId: "admin-1", version: 4, createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T01:00:00Z" };

function interrupted(current: unknown, mode = "412") {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const fetcher: Fetcher = async (path, init) => {
    calls.push({ path: String(path), init });
    if (String(path).endsWith("/csrf")) return Response.json({ csrfToken: "synthetic-csrf" });
    if (init?.method !== undefined && init.method !== "GET") {
      if (mode === "network") throw new TypeError("Synthetic response lost after commit");
      if (mode === "malformed") return new Response("invalid JSON", { status: 200 });
      return new Response("PRECONDITION_FAILED", { status: Number(mode) });
    }
    if (mode === "read-failure") throw new TypeError("Synthetic read outage");
    return Response.json(current);
  };
  return { fetcher, calls };
}

describe("committed catalogue and editorial mutation recovery", () => {
  it.each(["412", "malformed", "network"])("recovers all edited movie fields after %s without replaying the PATCH", async (mode) => {
    const { fetcher, calls } = interrupted(movie, mode);
    const changes = { title: " New title ", synopsis: " New synopsis ", director: " Director ", genres: [" Drama ", "Comedy"], cast: [" Actor "], releaseDate: null, runtimeMinutes: null };
    await expect(updateMovie(movie.id, 3, changes, fetcher)).resolves.toEqual({ ok: true, value: movie });
    expect(calls.filter((call) => call.init?.method === "PATCH")).toHaveLength(1);
    expect(calls.at(-1)).toMatchObject({ path: "/api/v1/admin/movies/movie-1", init: { cache: "no-store", credentials: "same-origin" } });
    expect(calls[1]?.init?.headers).toMatchObject({ "If-Match": '"3"', "X-CSRF-Token": "synthetic-csrf" });
  });

  it.each(["412", "malformed", "network"])("recovers announcement content and publication after %s", async (mode) => {
    const { fetcher, calls } = interrupted(announcement, mode);
    await expect(updateAnnouncement(announcement.id, 3, { title: " New title ", body: " New body ", movieId: null, state: "published" }, fetcher))
      .resolves.toEqual({ ok: true, value: announcement });
    expect(calls.filter((call) => call.init?.method === "PATCH")).toHaveLength(1);
    expect(calls.at(-1)?.path).toBe("/api/v1/admin/announcements/notice-1");
  });

  it.each(["published", "draft"] as const)("recovers the announcement list's %s transition", async (state) => {
    const current = { ...announcement, state };
    await expect(updateAnnouncement(announcement.id, 3, { state }, interrupted(current).fetcher))
      .resolves.toEqual({ ok: true, value: current });
  });

  it("recovers archive and restore using the requested lifecycle state", async () => {
    const archived = { ...movie, archivedAt: movie.updatedAt };
    const archive = interrupted(archived);
    await expect(archiveMovie(movie.id, 3, archive.fetcher)).resolves.toEqual({ ok: true, value: 4 });
    expect(archive.calls.filter((call) => call.init?.method === "DELETE")).toHaveLength(1);
    const restore = interrupted(movie);
    await expect(restoreMovie(movie.id, 3, restore.fetcher)).resolves.toEqual({ ok: true, value: movie });
    expect(restore.calls.at(-1)?.path).toBe("/api/v1/admin/movies/movie-1");
    expect(restore.calls.filter((call) => call.init?.method === "POST")).toHaveLength(1);
  });

  it.each([
    { ...movie, id: "another-movie" }, { ...movie, version: 3 }, { ...movie, title: "Other edit" },
    { ...movie, genres: ["Comedy", "Drama"] }, { ...movie, cast: [] }, { ...movie, runtimeMinutes: 90 },
    { ...movie, releaseDate: "2020-01-01" }, { ...movie, synopsis: "Other synopsis" }, { ...movie, version: "4" },
  ])("does not accept a movie whose read-back does not prove all requested fields: %j", async (current) => {
    const changes = { title: movie.title, synopsis: movie.synopsis, genres: movie.genres, cast: movie.cast, runtimeMinutes: null, releaseDate: null };
    await expect(updateMovie(movie.id, 3, changes, interrupted(current).fetcher)).resolves.toMatchObject({ ok: false, kind: "unavailable" });
  });

  it.each([
    { ...announcement, id: "another-notice" }, { ...announcement, version: 3 }, { ...announcement, state: "draft" },
    { ...announcement, state: "deleted" }, { ...announcement, body: "Other body" }, { ...announcement, movieId: "another-movie" },
  ])("does not accept a mismatching announcement: %j", async (current) => {
    await expect(updateAnnouncement(announcement.id, 3, { body: announcement.body, movieId: null, state: "published" }, interrupted(current).fetcher))
      .resolves.toMatchObject({ ok: false, kind: "unavailable" });
  });

  it("rejects opposite lifecycle states on recovery", async () => {
    await expect(archiveMovie(movie.id, 3, interrupted(movie).fetcher)).resolves.toMatchObject({ ok: false });
    await expect(restoreMovie(movie.id, 3, interrupted({ ...movie, archivedAt: movie.updatedAt }).fetcher)).resolves.toMatchObject({ ok: false });
  });

  it.each(["400", "401", "403", "409", "413", "415", "422", "428", "429"])("never reconciles or hides a definite %s rejection", async (mode) => {
    const { fetcher, calls } = interrupted(movie, mode);
    await expect(updateMovie(movie.id, 3, { title: movie.title }, fetcher)).resolves.toMatchObject({ ok: false });
    expect(calls).toHaveLength(2);
  });

  it("matches the server's lowercase UUID normalization for announcement movie references", async () => {
    const id = "00000000-0000-4000-8000-0000000000ab";
    const current = { ...announcement, movieId: id };
    await expect(updateAnnouncement(announcement.id, 3, { movieId: id.toUpperCase() }, interrupted(current).fetcher))
      .resolves.toEqual({ ok: true, value: current });
  });

  it.each(["rejected", "missing", "network"])("does not recover or dispatch after %s CSRF acquisition", async (mode) => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (path) => {
      calls.push(String(path));
      if (mode === "network") throw new TypeError("Synthetic CSRF outage");
      return mode === "rejected" ? new Response(null, { status: 503 }) : Response.json({});
    };
    await expect(updateMovie(movie.id, 3, { title: movie.title }, fetcher)).resolves.toMatchObject({ ok: false });
    await expect(updateAnnouncement(announcement.id, 3, { state: "published" }, fetcher)).resolves.toMatchObject({ ok: false });
    await expect(archiveMovie(movie.id, 3, fetcher)).resolves.toMatchObject({ ok: false });
    await expect(restoreMovie(movie.id, 3, fetcher)).resolves.toMatchObject({ ok: false });
    await expect(updateUserStatus("user-1", 3, { status: "suspended", reason: "A detailed reason" }, fetcher)).resolves.toMatchObject({ ok: false });
    expect(calls).toEqual(Array(5).fill("/api/v1/auth/csrf"));
  });

  it("keeps read-back failures and creates without an ID uncertain", async () => {
    const failing: Fetcher = async (path, init) => {
      if (String(path).endsWith("/csrf")) return Response.json({ csrfToken: "synthetic-csrf" });
      if (init?.method === "PATCH") return new Response("PRECONDITION_FAILED", { status: 412 });
      throw new TypeError("Synthetic read outage");
    };
    await expect(updateMovie(movie.id, 3, { title: movie.title }, failing)).resolves.toMatchObject({ ok: false });
    const create = interrupted(movie);
    await expect(createMovie(movie, create.fetcher)).resolves.toMatchObject({ ok: false });
    expect(create.calls).toHaveLength(2);
    const notice = interrupted(announcement);
    await expect(createAnnouncement(announcement, notice.fetcher)).resolves.toMatchObject({ ok: false });
    expect(notice.calls).toHaveLength(2);
  });
});
