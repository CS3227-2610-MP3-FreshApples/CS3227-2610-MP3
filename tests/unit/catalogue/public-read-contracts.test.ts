import { describe, expect, expectTypeOf, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { PublicAnnouncementReadRepository } from "../../../src/server/repositories/announcements";
import type { PublicMovieReadRepository } from "../../../src/server/repositories/catalogue";
import {
  MOVIE_LIST_ORDER,
  normalizePublicMovieListQuery,
  projectPublicMovieDetail,
  projectPublicMovieSummary,
  type PublicCatalogueReadService,
} from "../../../src/server/services/catalogue";
import {
  projectPublicAnnouncement,
  type PublicAnnouncementReadService,
} from "../../../src/server/services/announcements";
import type { MovieId } from "../../../src/server/shared";

const MOVIE_ID = "11111111-1111-4111-8111-111111111111" as MovieId;
const ANNOUNCEMENT_ID = "22222222-2222-4222-8222-222222222222";

describe("U-01 public movie query contract (D-79)", () => {
  it.each([undefined, null, "", " \t\n "])("normalizes an absent or blank q (%s) to no filter", (q) => {
    expect(normalizePublicMovieListQuery({ q, sort: "release_desc", page: 2, pageSize: 20 })).toEqual({
      ok: true,
      value: { q: null, sort: "release_desc", page: 2, pageSize: 20 },
    });
  });

  it("trims q and counts its 200-character limit in Unicode code points", () => {
    const accepted = `  ${"😀".repeat(200)}  `;
    expect(normalizePublicMovieListQuery({ q: accepted, sort: "title_asc", page: 1, pageSize: 100 })).toEqual({
      ok: true,
      value: { q: "😀".repeat(200), sort: "title_asc", page: 1, pageSize: 100 },
    });

    expect(
      normalizePublicMovieListQuery({ q: "😀".repeat(201), sort: "title_asc", page: 1, pageSize: 20 }),
    ).toEqual({
      ok: false,
      error: { q: ["must be at most 200 characters"] },
    });
  });

  it("rejects unknown sort values and records both stable ordering contracts", () => {
    expect(normalizePublicMovieListQuery({ q: null, sort: "popular", page: 1, pageSize: 20 })).toEqual({
      ok: false,
      error: { sort: ["must be release_desc or title_asc"] },
    });
    expect(MOVIE_LIST_ORDER).toEqual({
      release_desc: [
        { field: "releaseDate", direction: "desc", nulls: "last" },
        { field: "id", direction: "asc" },
      ],
      title_asc: [
        { field: "title", direction: "asc", caseInsensitive: true },
        { field: "id", direction: "asc" },
      ],
    });
  });
});

describe("U-01 public projection contracts", () => {
  it("projects only public movie list and detail fields, with aggregates and no reviews", () => {
    expect(
      projectPublicMovieSummary({
        id: MOVIE_ID,
        title: "Synthetic Film",
        releaseDate: "2026-10-20",
        genres: ["Drama"],
        averageRating: 8.5,
        reviewCount: 2,
      }),
    ).toEqual({
      id: MOVIE_ID,
      title: "Synthetic Film",
      releaseYear: 2026,
      genres: ["Drama"],
      averageRating: 8.5,
      reviewCount: 2,
    });

    expect(
      projectPublicMovieDetail({
        id: MOVIE_ID,
        title: "Synthetic Film",
        synopsis: "Plain-text synopsis.",
        releaseDate: null,
        genres: ["Drama"],
        director: "A. Director",
        cast: ["A. Performer"],
        runtimeMinutes: null,
        averageRating: null,
        reviewCount: 0,
      }),
    ).toEqual({
      id: MOVIE_ID,
      title: "Synthetic Film",
      synopsis: "Plain-text synopsis.",
      releaseDate: null,
      genres: ["Drama"],
      director: "A. Director",
      cast: ["A. Performer"],
      runtimeMinutes: null,
      averageRating: null,
      reviewCount: 0,
    });
  });

  it("projects the exact announcement DTO and permits a null active-movie reference", () => {
    expect(
      projectPublicAnnouncement({
        id: ANNOUNCEMENT_ID,
        publishedAt: new Date("2026-10-20T08:00:00.000Z"),
        title: "Programme update",
        body: "Plain-text announcement.",
        movie: null,
      }),
    ).toEqual({
      id: ANNOUNCEMENT_ID,
      publishedAt: "2026-10-20T08:00:00.000Z",
      title: "Programme update",
      body: "Plain-text announcement.",
      movie: null,
    });

    expect(
      projectPublicAnnouncement({
        id: ANNOUNCEMENT_ID,
        publishedAt: new Date("2026-10-20T08:00:00.000Z"),
        title: "Programme update",
        body: "Plain-text announcement.",
        movie: { id: MOVIE_ID, title: "Synthetic Film" },
      }),
    ).toMatchObject({ movie: { id: MOVIE_ID, title: "Synthetic Film" } });
  });
});

describe("U-01 repository and service interfaces", () => {
  it("exposes separate typed contracts for movie and announcement reads", () => {
    expectTypeOf<PublicMovieReadRepository>().toHaveProperty("listActive");
    expectTypeOf<PublicMovieReadRepository>().toHaveProperty("findActiveById");
    expectTypeOf<PublicCatalogueReadService>().toHaveProperty("listMovies");
    expectTypeOf<PublicCatalogueReadService>().toHaveProperty("getMovie");
    expectTypeOf<PublicAnnouncementReadRepository>().toHaveProperty("listPublished");
    expectTypeOf<PublicAnnouncementReadService>().toHaveProperty("listAnnouncements");
  });
});
