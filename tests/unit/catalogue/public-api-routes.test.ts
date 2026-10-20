import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../src/server/composition", () => ({
  publicCatalogueReadService: { listMovies: vi.fn(), getMovie: vi.fn() },
  publicAnnouncementReadService: { listAnnouncements: vi.fn() },
}));

import { GET as listMovies } from "../../../src/app/api/v1/movies/route";
import { GET as getMovie } from "../../../src/app/api/v1/movies/[id]/route";
import { GET as listAnnouncements } from "../../../src/app/api/v1/announcements/route";
import {
  publicAnnouncementReadService,
  publicCatalogueReadService,
} from "../../../src/server/composition";
import { ServiceUnavailableError } from "../../../src/server/shared";

const catalogue = vi.mocked(publicCatalogueReadService as NonNullable<typeof publicCatalogueReadService>);
const announcements = vi.mocked(
  publicAnnouncementReadService as NonNullable<typeof publicAnnouncementReadService>,
);
const MOVIE_ID = "10000000-0000-4000-8000-000000000001";

function request(path: string): Request {
  return new Request(`http://localhost:3000${path}`);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("U-01 public catalogue API routes", () => {
  it("returns a stable paginated movie envelope with request and no-store headers", async () => {
    catalogue.listMovies.mockResolvedValue({
      items: [
        {
          id: MOVIE_ID as never,
          title: "Fresh Apples",
          releaseYear: 2026,
          genres: ["Drama"],
          averageRating: 8.5,
          reviewCount: 2,
        },
      ],
      total: 1,
    });

    const response = await listMovies(
      request("/api/v1/movies?q=%20Apples%20&sort=title_asc&page=2&pageSize=10"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.json()).toEqual({
      items: [expect.objectContaining({ id: MOVIE_ID, title: "Fresh Apples" })],
      page: 2,
      pageSize: 10,
      total: 1,
    });
    expect(catalogue.listMovies).toHaveBeenCalledWith({
      q: "Apples",
      sort: "title_asc",
      page: 2,
      pageSize: 10,
    });
  });

  it("returns 422 for invalid pagination, q, and sort without calling the service", async () => {
    const response = await listMovies(
      request(`/api/v1/movies?q=${"x".repeat(201)}&sort=popular&page=0&pageSize=101`),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: {
        code: "validation_failed",
        fieldErrors: {
          page: ["must be a positive integer"],
          pageSize: ["must be an integer from 1 to 100"],
        },
      },
    });
    expect(catalogue.listMovies).not.toHaveBeenCalled();
  });

  it("returns field errors for invalid q and sort when pagination is valid", async () => {
    const response = await listMovies(
      request(`/api/v1/movies?q=${"😀".repeat(201)}&sort=popular&page=1&pageSize=20`),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: {
        code: "validation_failed",
        fieldErrors: {
          q: ["must be at most 200 characters"],
          sort: ["must be release_desc or title_asc"],
        },
      },
    });
    expect(catalogue.listMovies).not.toHaveBeenCalled();
  });

  it("returns active movie detail and indistinguishable 404s for malformed or unavailable IDs", async () => {
    catalogue.getMovie.mockResolvedValueOnce({
      id: MOVIE_ID as never,
      title: "Fresh Apples",
      synopsis: "Plain synopsis.",
      releaseDate: null,
      genres: [],
      director: "",
      cast: [],
      runtimeMinutes: null,
      averageRating: null,
      reviewCount: 0,
    });
    const found = await getMovie(request(`/api/v1/movies/${MOVIE_ID}`), {
      params: Promise.resolve({ id: MOVIE_ID }),
    });
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ id: MOVIE_ID, reviewCount: 0 });

    catalogue.getMovie.mockResolvedValueOnce(null);
    const absent = await getMovie(request(`/api/v1/movies/${MOVIE_ID}`), {
      params: Promise.resolve({ id: MOVIE_ID }),
    });
    const malformed = await getMovie(request("/api/v1/movies/not-a-uuid"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(absent.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect((await absent.json()).error.code).toBe("not_found");
    expect((await malformed.json()).error.code).toBe("not_found");
  });

  it("maps a read dependency failure to a safe 503 response", async () => {
    catalogue.listMovies.mockRejectedValue(new ServiceUnavailableError());

    const response = await listMovies(
      request("/api/v1/movies?sort=release_desc&page=1&pageSize=20"),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "service_unavailable", message: "The service is temporarily unavailable." },
    });
  });
});

describe("U-01 public announcements API route", () => {
  it("returns published announcements in the standard paginated envelope", async () => {
    announcements.listAnnouncements.mockResolvedValue({
      items: [
        {
          id: "20000000-0000-4000-8000-000000000001",
          publishedAt: "2026-10-20T03:00:00.000Z",
          title: "Programme update",
          body: "Plain body.",
          movie: null,
        },
      ],
      total: 1,
    });

    const response = await listAnnouncements(
      request("/api/v1/announcements?page=1&pageSize=20"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      items: [expect.objectContaining({ title: "Programme update", movie: null })],
      page: 1,
      pageSize: 20,
      total: 1,
    });
  });
});
