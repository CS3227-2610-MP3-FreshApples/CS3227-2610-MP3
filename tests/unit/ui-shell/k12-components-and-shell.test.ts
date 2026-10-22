import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { ConfirmDialog } from "../../../src/components/confirmation-dialog";
import { FormField, type FormFieldProps, TextField } from "../../../src/components/form-primitives";
import { Pagination } from "../../../src/components/pagination";
import { AggregateRating, RatingValue } from "../../../src/components/rating-primitives";
import { StatusBadge } from "../../../src/components/status-primitives";
import { DataTable } from "../../../src/components/table-state";
import RootLayout from "../../../src/app/layout";
import Home from "../../../src/app/page";
import PublicLayout from "../../../src/app/(public)/layout";
import UserLayout from "../../../src/app/app/layout";
import AdminLayout from "../../../src/app/admin/layout";

function html(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

function child(): React.ReactElement {
  return createElement("p", null, "Content");
}

describe("K12 component contract", () => {
  it("gives Admin catalogue tables and pagination a responsive presentation shell", () => {
    const table = html(createElement(DataTable<{ id: string; title: string }>, {
      caption: "Movies",
      columns: [{ header: "Title", cell: (movie: { id: string; title: string }) => movie.title }],
      emptyMessage: "No movies found",
      rowKey: (movie: { id: string }) => movie.id,
      rows: [{ id: "movie-1", title: "Arrival" }],
    }));
    const pagination = html(createElement(Pagination, {
      hrefForPage: (page: number) => `/admin/movies?page=${page}`,
      page: 1,
      pageSize: 10,
      total: 25,
    }));

    expect(table).toContain('data-table-shell="admin"');
    expect(table).toContain("overflow-x-auto");
    expect(pagination).toContain('data-pagination="admin"');
    expect(pagination).toContain("justify-between");
  });

  it("renders DataTable captions, columns, stable row keys, and an accessible empty state", () => {
    const populated = html(createElement(DataTable<{ id: string; title: string }>, {
      caption: "Movies",
      columns: [
        { header: "Title", cell: (movie: { id: string; title: string }) => movie.title },
      ],
      emptyMessage: "No movies found",
      rowKey: (movie: { id: string }) => movie.id,
      rows: [{ id: "movie-1", title: "Arrival" }],
    }));
    const empty = html(createElement(DataTable<{ id: string; title: string }>, {
      caption: "Movies",
      columns: [{ header: "Title", cell: () => "" }],
      emptyMessage: "No movies found",
      rowKey: () => "unused",
      rows: [],
    }));

    expect(populated).toContain("Movies");
    expect(populated).toContain("Title");
    expect(populated).toContain("Arrival");
    expect(populated).toContain('data-row-key="movie-1"');
    expect(empty).toContain("No movies found");
    expect(empty).toContain('role="status"');
  });

  it("renders textual status and approved rating/aggregate empty states", () => {
    expect(html(createElement(StatusBadge, { label: "Awaiting review", tone: "warning" }))).toContain("Awaiting review");
    expect(html(createElement(RatingValue, { value: 8 }))).toContain("8/10");
    expect(html(createElement(AggregateRating, { average: 8.3, count: 12, emptyLabel: "No ratings yet" }))).toContain("8.3/10");
    expect(html(createElement(AggregateRating, { average: null, count: 0, emptyLabel: "No ratings yet" }))).toContain("No ratings yet");
  });

  it("wires FormField/TextField labels, hints, and field-associated errors", () => {
    const fieldProps: FormFieldProps = {
      children: createElement("input"),
      error: "Title is required",
      hint: "Use the official title",
      label: "Movie title",
      name: "title",
    };
    const field = html(createElement(FormField, fieldProps));
    const textField = html(createElement(TextField, {
      error: "Title is required",
      hint: "Use the official title",
      label: "Movie title",
      name: "title",
    }));

    for (const rendered of [field, textField]) {
      expect(rendered).toContain('for="title"');
      expect(rendered).toContain('aria-describedby="title-hint title-error"');
      expect(rendered).toContain("Title is required");
      expect(rendered).toContain("Use the official title");
    }
  });

  it("creates functional bounded pagination destinations, including empty totals", () => {
    const first = html(createElement(Pagination, {
      hrefForPage: (page: number) => `/movies?page=${page}`,
      page: 1,
      pageSize: 10,
      total: 25,
    }));
    const middle = html(createElement(Pagination, {
      hrefForPage: (page: number) => `/movies?page=${page}`,
      page: 2,
      pageSize: 10,
      total: 25,
    }));
    const empty = html(createElement(Pagination, {
      hrefForPage: (page: number) => `/movies?page=${page}`,
      page: 1,
      pageSize: 10,
      total: 0,
    }));

    expect(first).not.toContain('href="/movies?page=0"');
    expect(first).toContain('href="/movies?page=2"');
    expect(middle).toContain('href="/movies?page=1"');
    expect(middle).toContain('href="/movies?page=3"');
    expect(empty).toContain("Page 0 of 0");
    expect(empty).not.toContain("href=");
  });

  it("renders ConfirmDialog only when open and names its target", () => {
    const onConfirm = () => undefined;
    const onCancel = () => undefined;
    const closed = html(createElement(ConfirmDialog, {
      confirmLabel: "Archive movie",
      consequence: "The movie will be unavailable publicly.",
      onCancel,
      onConfirm,
      open: false,
      targetName: "Arrival",
      title: "Confirm archive",
    }));
    const open = html(createElement(ConfirmDialog, {
      confirmLabel: "Archive movie",
      consequence: "The movie will be unavailable publicly.",
      onCancel,
      onConfirm,
      open: true,
      targetName: "Arrival",
      title: "Confirm archive",
    }));

    expect(closed).toBe("");
    expect(open).toContain('role="dialog"');
    expect(open).toContain("Arrival");
    expect(open).toContain("Archive movie");
    expect(open.toLowerCase()).not.toContain("authorize");
  });
});

describe("route-shell isolation contract", () => {
  it("keeps public, user, and admin shells isolated with one main landmark", () => {
    const publicRoute = html(createElement(PublicLayout, null, child()));
    const userRoute = html(createElement(RootLayout, null, createElement(UserLayout, null, child())));
    const adminRoute = html(createElement(RootLayout, null, createElement(AdminLayout, null, child())));
    const publicHome = html(createElement(RootLayout, null, createElement(Home)));

    expect(publicRoute.match(/<main/g)?.length).toBe(1);
    expect(publicRoute).toContain('href="/movies"');
    expect(userRoute.match(/<main/g)?.length).toBe(1);
    expect(userRoute).toContain('href="/app/reviews"');
    expect(userRoute).not.toContain('href="/movies"');
    expect(userRoute).not.toContain('href="/admin"');
    expect(adminRoute.match(/<main/g)?.length).toBe(1);
    expect(adminRoute).toContain('href="/admin/reviews"');
    expect(adminRoute).not.toContain('href="/app/reviews"');
    expect(adminRoute).not.toContain('href="/movies"');
    expect(publicHome.match(/<main/g)?.length).toBe(1);
    expect(publicHome).toContain('href="/announcements"');
  });
});
