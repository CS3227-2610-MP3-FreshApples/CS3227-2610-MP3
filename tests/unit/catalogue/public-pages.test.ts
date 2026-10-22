import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../src/server/composition", () => ({
  publicCatalogueReadService: { listMovies: vi.fn(), getMovie: vi.fn() },
  publicAnnouncementReadService: { listAnnouncements: vi.fn() },
}));

import AnnouncementsPage from "../../../src/app/(public)/announcements/page";
import AnnouncementsError from "../../../src/app/(public)/announcements/error";
import AnnouncementsLoading from "../../../src/app/(public)/announcements/loading";
import MovieDetailsPage from "../../../src/app/(public)/movies/[id]/page";
import MovieDetailsError from "../../../src/app/(public)/movies/[id]/error";
import MovieDetailsLoading from "../../../src/app/(public)/movies/[id]/loading";
import MoviesPage from "../../../src/app/(public)/movies/page";
import MoviesError from "../../../src/app/(public)/movies/error";
import MoviesLoading from "../../../src/app/(public)/movies/loading";
import {
  publicAnnouncementReadService,
  publicCatalogueReadService,
} from "../../../src/server/composition";
import Home from "../../../src/app/page";

const catalogue = vi.mocked(publicCatalogueReadService as NonNullable<typeof publicCatalogueReadService>);
const announcements = vi.mocked(
  publicAnnouncementReadService as NonNullable<typeof publicAnnouncementReadService>,
);
const MOVIE_ID = "10000000-0000-4000-8000-000000000001";

async function html(element: ReactElement | Promise<ReactElement>): Promise<string> {
  return renderToStaticMarkup(await element);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("U-01 public catalogue pages", () => {
  it("renders a focused home hierarchy with discovery actions", () => {
    const rendered = renderToStaticMarkup(createElement(Home));

    expect(rendered).toContain("Find your next movie through community reviews.");
    expect(rendered).toContain('href="/movies"');
    expect(rendered).toContain('href="/announcements"');
    expect(rendered).toContain("Moderated before publication");
    expect(rendered).not.toContain("Browse movies and community reviews.");
  });

  it("renders an accessible empty movie result with the direct service query", async () => {
    catalogue.listMovies.mockResolvedValue({ items: [], total: 0 });

    const rendered = await html(MoviesPage({
      searchParams: Promise.resolve({ q: "  space  ", sort: "title_asc", page: "1" }),
    }));

    expect(catalogue.listMovies).toHaveBeenCalledWith({
      q: "space",
      sort: "title_asc",
      page: 1,
      pageSize: 20,
    });
    expect(rendered).toContain("Movies");
    expect(rendered).toContain('name="q"');
    expect(rendered).toContain('name="sort"');
    expect(rendered).toContain('role="status"');
    expect(rendered).toContain('No movies match “space”.');
    expect(rendered).not.toContain("<img");
  });

  it("renders a responsive movie result card and a clear-search action", async () => {
    catalogue.listMovies.mockResolvedValue({
      items: [{
        id: MOVIE_ID as never,
        title: "Fresh Apples",
        releaseYear: 2026,
        genres: ["Drama"],
        averageRating: 8.567,
        reviewCount: 2,
      }],
      total: 1,
    });

    const rendered = await html(MoviesPage({
      searchParams: Promise.resolve({ q: "apple", sort: "release_desc", page: "1" }),
    }));

    expect(rendered).toContain("border-slate-200");
    expect(rendered).toContain("grid-cols-1");
    expect(rendered).toContain('href="/movies"');
    expect(rendered).toContain("Clear search");
    expect(rendered).toContain("8.5/10 from 2 reviews");
  });

  it("renders public movie metadata and aggregates without a review listing", async () => {
    catalogue.getMovie.mockResolvedValue({
      id: MOVIE_ID as never,
      title: "Fresh Apples",
      synopsis: "A plain synopsis.",
      releaseDate: "2026-02-03",
      genres: ["Drama"],
      director: "Director",
      cast: ["Performer"],
      runtimeMinutes: 123,
      averageRating: 8.5,
      reviewCount: 2,
    });

    const rendered = await html(MovieDetailsPage({
      params: Promise.resolve({ id: MOVIE_ID }),
    }));

    expect(rendered).toContain("Fresh Apples");
    expect(rendered).toContain("A plain synopsis.");
    expect(rendered).toContain("Director");
    expect(rendered).toContain("8.5/10 from 2 reviews");
    expect(rendered).toContain('class="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800');
    expect(rendered).toContain('href="/movies"');
    expect(rendered).toContain("grid-cols-1");
    expect(rendered).toContain("Movie details");
    expect(rendered).toContain("Community reviews");
    expect(rendered).not.toContain("<img");
  });

  it("renders published announcement content and only active movie references", async () => {
    announcements.listAnnouncements.mockResolvedValue({
      items: [
        {
          id: "20000000-0000-4000-8000-000000000001",
          publishedAt: "2026-10-20T03:00:00.000Z",
          title: "Programme update",
          body: "Plain text announcement.",
          movie: { id: MOVIE_ID as never, title: "Fresh Apples" },
        },
      ],
      total: 1,
    });

    const rendered = await html(AnnouncementsPage());

    expect(announcements.listAnnouncements).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(rendered).toContain("Programme update");
    expect(rendered).toContain("Plain text announcement.");
    expect(rendered).toContain(`href="/movies/${MOVIE_ID}"`);
    expect(rendered).toContain("Fresh Apples");
    expect(rendered).toContain("max-w-3xl");
    expect(rendered).toContain("border-slate-200");
    expect(rendered).not.toContain("<img");
  });

  it("provides text-only loading and error states for each public read route", async () => {
    const retry = vi.fn();
    const components = [
      createElement(MoviesLoading),
      createElement(MovieDetailsLoading),
      createElement(AnnouncementsLoading),
      createElement(MoviesError, { error: new Error("database unavailable"), reset: retry }),
      createElement(MovieDetailsError, { error: new Error("database unavailable"), reset: retry }),
      createElement(AnnouncementsError, { error: new Error("database unavailable"), reset: retry }),
    ];

    const rendered = await html(createElement("div", null, components));

    expect(rendered).toContain("Loading movies");
    expect(rendered).toContain("Loading movie details");
    expect(rendered).toContain("Loading announcements");
    expect(rendered).toContain("We could not load this page. Please try again.");
    expect(rendered).toContain('type="button"');
    expect(rendered).not.toContain("database unavailable");
    expect(rendered).not.toContain("<img");
  });
});
