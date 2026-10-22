import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RatingInput, TextField } from "../../../src/components/form-primitives";
import { Pagination } from "../../../src/components/pagination";
import { AggregateRating } from "../../../src/components/rating-primitives";
import { TableState } from "../../../src/components/table-state";
import { LiveRegion, StatusBadge, StatusMessage } from "../../../src/components/status-primitives";

function html(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("K12 UI primitives", () => {
  it("associates labels and validation errors with keyboard-reachable controls", () => {
    const field = html(createElement(TextField, {
      id: "title",
      label: "Movie title",
      error: "Title is required",
    }));
    const rating = html(createElement(RatingInput, { id: "rating", value: 8 }));

    expect(field).toContain('<label for="title">Movie title</label>');
    expect(field).toContain('id="title"');
    expect(field).toContain('aria-describedby="title-error"');
    expect(field).toContain('id="title-error"');
    expect(field).toContain("Title is required");
    expect(field).toContain("focus-visible");
    expect(rating).toContain('aria-label="Rating (out of 10)"');
    expect(rating).toContain('min="1"');
    expect(rating).toContain('max="10"');
  });

  it("renders explicit loading, empty, and error table states", () => {
    for (const state of ["loading", "empty", "error"] as const) {
      const rendered = html(createElement(TableState, { state }));

      expect(rendered).toContain(`data-state="${state}"`);
      expect(rendered).toContain(state[0].toUpperCase() + state.slice(1));
    }
  });

  it("bounds pagination controls at the first and last page", () => {
    const firstPage = html(createElement(Pagination, {
      hrefForPage: (page) => `/movies?page=${page}`,
      page: 1,
      pageSize: 10,
      total: 25,
    }));
    const lastPage = html(createElement(Pagination, {
      hrefForPage: (page) => `/movies?page=${page}`,
      page: 3,
      pageSize: 10,
      total: 25,
    }));

    expect(firstPage).toContain('aria-label="Pagination"');
    expect(firstPage).toContain('aria-label="Next page"');
    expect(firstPage).toContain('aria-disabled="true"');
    expect(firstPage).toContain('href="/movies?page=2"');
    expect(lastPage).toContain('href="/movies?page=2"');
    expect(lastPage).toContain('aria-disabled="true"');
  });

  it("communicates statuses and async completion with text and a polite live region", () => {
    const status = html(createElement(StatusMessage, { status: "success" }, "Saved"));
    const announcement = html(createElement(LiveRegion, { message: "Review submitted" }));

    expect(status).toContain("Saved");
    expect(status).toContain('data-status="success"');
    expect(announcement).toContain('aria-live="polite"');
    expect(announcement).toContain('role="status"');
    expect(announcement).toContain("Review submitted");
  });

  it("gives status treatments visible high-contrast surface hooks", () => {
    const success = html(createElement(StatusMessage, { status: "success" }, "Saved"));
    const warning = html(createElement(StatusBadge, { label: "Awaiting review", tone: "warning" }));

    expect(success).toContain("border-green");
    expect(success).toContain("bg-green");
    expect(warning).toContain("bg-amber");
    expect(warning).toContain("text-amber");
  });

  it("formats direct and aggregate ratings according to the product examples", () => {
    expect(html(createElement(RatingInput, { id: "rating", value: 8 }))).toContain("8/10");
    expect(html(createElement(AggregateRating, { average: 8.367, count: 12, emptyLabel: "No ratings yet" }))).toContain("8.36/10");
  });
});
