import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../src/server/composition", () => ({
  publicCatalogueReadService: null,
  publicAnnouncementReadService: null,
}));

import AnnouncementsPage from "../../../src/app/(public)/announcements/page";
import MovieDetailsPage from "../../../src/app/(public)/movies/[id]/page";
import MoviesPage from "../../../src/app/(public)/movies/page";

const MOVIE_ID = "10000000-0000-4000-8000-000000000001";

async function html(element: ReactElement | Promise<ReactElement>): Promise<string> {
  return renderToStaticMarkup(await element);
}

describe("U-01 public pages when read services are unavailable", () => {
  it("renders a safe unavailable state instead of throwing", async () => {
    const rendered = await Promise.all([
      html(AnnouncementsPage()),
      html(MoviesPage({ searchParams: Promise.resolve({}) })),
      html(MovieDetailsPage({ params: Promise.resolve({ id: MOVIE_ID }) })),
    ]);

    for (const page of rendered) {
      expect(page).toContain('role="alert"');
      expect(page).toContain("The service is temporarily unavailable. Please try again later.");
      expect(page).not.toContain("Public announcement read service is unavailable.");
      expect(page).not.toContain("Public catalogue read service is unavailable.");
    }
  });
});
