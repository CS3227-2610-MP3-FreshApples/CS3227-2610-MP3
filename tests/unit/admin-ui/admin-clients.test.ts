import { describe, expect, it } from "vitest";

import type { Fetcher } from "../../../src/app/admin/_lib/admin-http";
import {
  announcementWriteFromForm,
  createAnnouncement,
  getAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from "../../../src/app/admin/_lib/announcement-client";
import {
  archiveMovie,
  createMovie,
  getMovie,
  listMovies,
  restoreMovie,
  updateMovie,
  type MovieWrite,
} from "../../../src/app/admin/_lib/movie-client";
import { EMPTY_MOVIE_FORM, movieFormFromMovie, movieWriteFromForm } from "../../../src/app/admin/_lib/movie-form";

// B#6 commit 3: the Movie and Announcement clients call exactly the api.md 8.1 Admin endpoints and accept
// only the documented projections.

const MOVIE_ID = "00000000-0000-4000-8000-0000000000a1";
const ANNOUNCEMENT_ID = "00000000-0000-4000-8000-0000000000b1";

const movie = {
  id: MOVIE_ID,
  title: "Synthetic Movie",
  synopsis: "A synthetic synopsis.",
  releaseDate: "2020-02-29",
  genres: ["Drama", "Comedy"],
  director: "Synthetic Director",
  cast: ["Actor One", "Actor Two"],
  runtimeMinutes: 101,
  archivedAt: null,
  version: 3,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T01:00:00.000Z",
};

const announcement = {
  id: ANNOUNCEMENT_ID,
  title: "Synthetic notice",
  body: "Body text.",
  movieId: null,
  state: "draft",
  publishedAt: null,
  authorId: "00000000-0000-4000-8000-0000000000c1",
  version: 1,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Call = { input: string; init?: RequestInit };

/** Answers the CSRF request, then returns `response` for the API call. */
function api(response: () => Response): { calls: Call[]; fetcher: Fetcher } {
  const calls: Call[] = [];
  return {
    calls,
    fetcher: async (input, init) => {
      calls.push({ input: String(input), init });
      return String(input) === "/api/v1/auth/csrf" ? json({ csrfToken: "csrf_v1.synthetic" }) : response();
    },
  };
}

function lastCall(calls: Call[]): Call {
  const call = calls.at(-1);
  if (call === undefined) throw new Error("no call");
  return call;
}

function sentBody(call: Call): unknown {
  return JSON.parse(String(call.init?.body));
}

function header(call: Call, name: string): string | undefined {
  return (call.init?.headers as Record<string, string> | undefined)?.[name];
}

describe("movie client", () => {
  it("lists one page of 20 including archived Movies", async () => {
    const { calls, fetcher } = api(() => json({ items: [movie, { ...movie, id: "x", archivedAt: "2026-10-20T02:00:00.000Z" }], page: 2, pageSize: 20, total: 22 }));
    const result = await listMovies(2, fetcher);
    expect(result.ok && result.value.items).toHaveLength(2);
    expect(lastCall(calls).input).toBe("/api/v1/admin/movies?page=2&pageSize=20");
  });

  it("rejects a list whose items are not Admin Movies", async () => {
    const { fetcher } = api(() => json({ items: [{ ...movie, genres: "Drama" }], page: 1, pageSize: 20, total: 1 }));
    await expect(listMovies(1, fetcher)).resolves.toMatchObject({ ok: false, kind: "unavailable" });
  });

  it("encodes the path id when reading one Movie", async () => {
    const { calls, fetcher } = api(() => json(movie));
    await getMovie("../users", fetcher);
    expect(lastCall(calls).input).toBe("/api/v1/admin/movies/..%2Fusers");
  });

  it("creates with POST and no If-Match", async () => {
    const write: MovieWrite = { title: "T", synopsis: "S", releaseDate: null, genres: [], director: "", cast: [], runtimeMinutes: null };
    const { calls, fetcher } = api(() => json(movie, 201));
    await expect(createMovie(write, fetcher)).resolves.toMatchObject({ ok: true, value: { id: MOVIE_ID } });
    const call = lastCall(calls);
    expect(call.input).toBe("/api/v1/admin/movies");
    expect(call.init?.method).toBe("POST");
    expect(header(call, "If-Match")).toBeUndefined();
    expect(sentBody(call)).toEqual(write);
  });

  it("updates with PATCH and the loaded version as If-Match", async () => {
    const { calls, fetcher } = api(() => json({ ...movie, version: 4 }));
    await expect(updateMovie(MOVIE_ID, 3, { title: "New" }, fetcher)).resolves.toMatchObject({ ok: true, value: { version: 4 } });
    const call = lastCall(calls);
    expect(call.init?.method).toBe("PATCH");
    expect(header(call, "If-Match")).toBe("\"3\"");
    expect(header(call, "X-CSRF-Token")).toBe("csrf_v1.synthetic");
  });

  it("archives with DELETE and returns the resulting ETag version", async () => {
    const { calls, fetcher } = api(() => new Response(null, { status: 204, headers: { ETag: "\"4\"" } }));
    await expect(archiveMovie(MOVIE_ID, 3, fetcher)).resolves.toEqual({ ok: true, value: 4 });
    const call = lastCall(calls);
    expect(call.input).toBe(`/api/v1/admin/movies/${MOVIE_ID}`);
    expect(call.init?.method).toBe("DELETE");
    expect(header(call, "If-Match")).toBe("\"3\"");
  });

  it("reports archive as unavailable while the orchestrator is unwired (D-84 503)", async () => {
    const { fetcher } = api(() => json({ error: { code: "service_unavailable", message: "x", requestId: "r" } }, 503));
    await expect(archiveMovie(MOVIE_ID, 3, fetcher)).resolves.toMatchObject({ ok: false, kind: "unavailable" });
  });

  it("restores with POST …/restore and If-Match", async () => {
    const { calls, fetcher } = api(() => json({ ...movie, version: 5 }));
    await expect(restoreMovie(MOVIE_ID, 4, fetcher)).resolves.toMatchObject({ ok: true, value: { version: 5 } });
    const call = lastCall(calls);
    expect(call.input).toBe(`/api/v1/admin/movies/${MOVIE_ID}/restore`);
    expect(call.init?.method).toBe("POST");
    expect(header(call, "If-Match")).toBe("\"4\"");
    expect(call.init?.body).toBeUndefined();
  });
});

describe("movie form conversion", () => {
  it("round-trips a Movie through the form", () => {
    const values = movieFormFromMovie(movie);
    expect(values).toEqual({
      title: "Synthetic Movie",
      synopsis: "A synthetic synopsis.",
      releaseDate: "2020-02-29",
      genres: "Drama\nComedy",
      director: "Synthetic Director",
      cast: "Actor One\nActor Two",
      runtimeMinutes: "101",
    });
    expect(movieWriteFromForm(values)).toEqual({
      ok: true,
      value: {
        title: movie.title,
        synopsis: movie.synopsis,
        releaseDate: movie.releaseDate,
        genres: movie.genres,
        director: movie.director,
        cast: movie.cast,
        runtimeMinutes: movie.runtimeMinutes,
      },
    });
  });

  it("maps empty optional fields to the D-80 defaults and splits lists by line, keeping order", () => {
    expect(movieWriteFromForm({ ...EMPTY_MOVIE_FORM, title: "T", synopsis: "S" })).toEqual({
      ok: true,
      value: { title: "T", synopsis: "S", releaseDate: null, genres: [], director: "", cast: [], runtimeMinutes: null },
    });
    const lists = movieWriteFromForm({ ...EMPTY_MOVIE_FORM, genres: " Zeta \r\n\n Alpha\n", cast: "B\nA" });
    expect(lists.ok && lists.value.genres).toEqual(["Zeta", "Alpha"]);
    expect(lists.ok && lists.value.cast).toEqual(["B", "A"]);
  });

  it("leaves title and synopsis untrimmed and unvalidated for the server (D-80)", () => {
    const result = movieWriteFromForm({ ...EMPTY_MOVIE_FORM, title: "  ", synopsis: "" });
    expect(result).toMatchObject({ ok: true, value: { title: "  ", synopsis: "" } });
  });

  it.each(["1.5", "abc", "-3", "1e3"])("rejects runtime %j as a field error without sending", (runtime) => {
    expect(movieWriteFromForm({ ...EMPTY_MOVIE_FORM, runtimeMinutes: runtime })).toEqual({
      ok: false,
      fieldErrors: { runtimeMinutes: [expect.any(String)] },
    });
  });

  it("passes an out-of-range whole runtime to the server to reject", () => {
    expect(movieWriteFromForm({ ...EMPTY_MOVIE_FORM, runtimeMinutes: " 5000 " })).toMatchObject({ ok: true, value: { runtimeMinutes: 5000 } });
  });
});

describe("announcement client", () => {
  it("lists every state, one page of 20", async () => {
    const { calls, fetcher } = api(() => json({
      items: [announcement, { ...announcement, id: "p", state: "published", publishedAt: "2026-10-20T00:00:00.000Z" }, { ...announcement, id: "d", state: "deleted" }],
      page: 1,
      pageSize: 20,
      total: 3,
    }));
    const result = await listAnnouncements(1, fetcher);
    expect(result.ok && result.value.items.map((item) => item.state)).toEqual(["draft", "published", "deleted"]);
    expect(lastCall(calls).input).toBe("/api/v1/admin/announcements?page=1&pageSize=20");
  });

  it("rejects an unknown state", async () => {
    const { fetcher } = api(() => json({ ...announcement, state: "archived" }));
    await expect(getAnnouncement(ANNOUNCEMENT_ID, fetcher)).resolves.toMatchObject({ ok: false, kind: "unavailable" });
  });

  it("creates a draft from content only", async () => {
    const { calls, fetcher } = api(() => json(announcement, 201));
    await createAnnouncement({ title: "T", body: "B", movieId: null }, fetcher);
    const call = lastCall(calls);
    expect(call.init?.method).toBe("POST");
    expect(sentBody(call)).toEqual({ title: "T", body: "B", movieId: null });
  });

  it("publishes with content in one PATCH under If-Match", async () => {
    const { calls, fetcher } = api(() => json({ ...announcement, state: "published", version: 2 }));
    await expect(updateAnnouncement(ANNOUNCEMENT_ID, 1, { title: "T", body: "B", movieId: null, state: "published" }, fetcher))
      .resolves.toMatchObject({ ok: true, value: { state: "published" } });
    const call = lastCall(calls);
    expect(call.input).toBe(`/api/v1/admin/announcements/${ANNOUNCEMENT_ID}`);
    expect(call.init?.method).toBe("PATCH");
    expect(header(call, "If-Match")).toBe("\"1\"");
    expect(sentBody(call)).toEqual({ title: "T", body: "B", movieId: null, state: "published" });
  });

  it("maps a PATCH of a deleted announcement to conflict", async () => {
    const { fetcher } = api(() => json({ error: { code: "conflict", message: "x", requestId: "r" } }, 409));
    await expect(updateAnnouncement(ANNOUNCEMENT_ID, 2, { state: "published" }, fetcher)).resolves.toMatchObject({ ok: false, kind: "conflict" });
  });

  it("carries a movieId field error back to the form", async () => {
    const { fetcher } = api(() => json({ error: { code: "validation_failed", message: "x", requestId: "r", fieldErrors: { movieId: ["must reference an existing Movie"] } } }, 422));
    await expect(createAnnouncement({ title: "T", body: "B", movieId: MOVIE_ID }, fetcher)).resolves.toMatchObject({
      ok: false,
      kind: "validation",
      fieldErrors: { movieId: ["must reference an existing Movie"] },
    });
  });

  it("treats an empty or blank Movie ID as no reference and keeps other text as typed", () => {
    expect(announcementWriteFromForm({ title: " T ", body: "B", movieId: "  " })).toEqual({ title: " T ", body: "B", movieId: null });
    expect(announcementWriteFromForm({ title: "T", body: "B", movieId: ` ${MOVIE_ID} ` })).toEqual({ title: "T", body: "B", movieId: MOVIE_ID });
  });
});
