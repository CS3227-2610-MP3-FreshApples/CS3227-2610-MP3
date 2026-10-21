import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnnouncementForm } from "../../../src/app/admin/announcements/_components/announcement-form";
import { AnnouncementList } from "../../../src/app/admin/announcements/_components/announcement-list";
import { CreateAnnouncement } from "../../../src/app/admin/announcements/_components/create-announcement";
import { EditAnnouncement } from "../../../src/app/admin/announcements/_components/edit-announcement";
import { CreateMovie } from "../../../src/app/admin/movies/_components/create-movie";
import { EditMovie } from "../../../src/app/admin/movies/_components/edit-movie";
import { MovieForm } from "../../../src/app/admin/movies/_components/movie-form";
import { MovieList } from "../../../src/app/admin/movies/_components/movie-list";
import AdminOverviewPage from "../../../src/app/admin/page";
import AdminReportsPage from "../../../src/app/admin/reports/page";
import AdminReviewsPage from "../../../src/app/admin/reviews/page";
import AdminUsersPage from "../../../src/app/admin/users/page";
import { EMPTY_MOVIE_FORM } from "../../../src/app/admin/_lib/movie-form";

// B#6 commit 3 (A-01/A-02 UI): structural checks that hold without a browser. Interaction (submit, the
// archive ConfirmDialog, kept text after errors) is covered by tests/e2e/admin-catalogue.spec.ts.

const ADMIN_DIR = resolve(process.cwd(), "src/app/admin");
const K12_MODULES = new Set([
  "confirmation-dialog",
  "form-primitives",
  "page-placeholder",
  "pagination",
  "rating-primitives",
  "route-shell",
  "status-primitives",
  "table-state",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1]!);
}

const files = sourceFiles(ADMIN_DIR).map((path) => ({ path: relative(process.cwd(), path), source: readFileSync(path, "utf8") }));

describe("Admin UI module boundaries", () => {
  it("finds the Admin movie and announcement sources", () => {
    expect(files.map((file) => file.path.replaceAll("\\", "/"))).toEqual(expect.arrayContaining([
      "src/app/admin/movies/page.tsx",
      "src/app/admin/movies/new/page.tsx",
      "src/app/admin/movies/[id]/page.tsx",
      "src/app/admin/announcements/page.tsx",
      "src/app/admin/announcements/new/page.tsx",
      "src/app/admin/announcements/[id]/page.tsx",
    ]));
  });

  it.each(files.map((file) => [file.path, file.source]))("%s never imports src/server or server-only", (_path, source) => {
    for (const specifier of importsOf(source)) {
      expect(specifier).not.toMatch(/(^|\/)server(\/|$)/);
      expect(specifier).not.toBe("server-only");
    }
  });

  it.each(files.map((file) => [file.path, file.source]))("%s uses only K12 modules from src/components", (_path, source) => {
    for (const specifier of importsOf(source)) {
      const match = /\/components\/([^/]+)$/.exec(specifier);
      if (match !== null) expect(K12_MODULES).toContain(match[1]);
    }
  });

  it.each(files.map((file) => [file.path, file.source]))("%s declares \"use client\" whenever it uses React state or effects", (_path, source) => {
    if (/\buse(State|Effect|Ref|Callback)\b/.test(source)) {
      expect(source.trimStart().startsWith("\"use client\";")).toBe(true);
    }
  });

  it("calls the HTTP API only through the CSRF-aware helpers", () => {
    for (const file of files) {
      if (file.path.replaceAll("\\", "/").endsWith("_lib/admin-http.ts")) continue;
      expect(file.source).not.toMatch(/\bfetch\(/);
    }
  });
});

describe("Admin UI initial render", () => {
  it("presents unavailable Admin workspaces honestly without fabricated data or actions", () => {
    for (const Page of [AdminReviewsPage, AdminReportsPage, AdminUsersPage]) {
      const html = renderToStaticMarkup(createElement(Page));
      expect(html).toContain('data-admin-state="unavailable"');
      expect(html).toContain("No admin data is available yet.");
      expect(html).toContain('href="/admin"');
      expect(html).not.toContain("Suspend");
      expect(html).not.toContain("Close report");
    }
  });

  it("presents the Admin overview as an actionable operations hub", () => {
    const html = renderToStaticMarkup(createElement(AdminOverviewPage));
    expect(html).toContain("Operations at a glance");
    expect(html).toContain("Manage catalogue");
    expect(html).toContain('href="/admin/movies"');
    expect(html).toContain("Moderation workspace");
    expect(html).toContain('href="/admin/reviews"');
  });

  it("shows the movie list loading state, the create link and no open dialog", () => {
    const html = renderToStaticMarkup(createElement(MovieList, { page: 1 }));
    expect(html).toContain("Loading movies…");
    expect(html).toContain('href="/admin/movies/new"');
    expect(html).not.toContain("<dialog");
  });

  it("shows the announcement list loading state and the create link", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementList, { page: 1 }));
    expect(html).toContain("Loading announcements…");
    expect(html).toContain('href="/admin/announcements/new"');
  });

  it("shows loading states for the editors before the record arrives", () => {
    expect(renderToStaticMarkup(createElement(EditMovie, { movieId: "x" }))).toContain("Loading movie…");
    expect(renderToStaticMarkup(createElement(EditAnnouncement, { announcementId: "x" }))).toContain("Loading announcement…");
  });

  it("labels every Movie field and ties each hint to its control", () => {
    const html = renderToStaticMarkup(createElement(CreateMovie));
    for (const [name, label] of [
      ["title", "Title"],
      ["synopsis", "Synopsis"],
      ["releaseDate", "Release date"],
      ["genres", "Genres"],
      ["director", "Director"],
      ["cast", "Cast"],
      ["runtimeMinutes", "Runtime (minutes)"],
    ]) {
      expect(html).toContain(`<label for="${name}">${label}</label>`);
      expect(html).toContain(`id="${name}-hint"`);
      expect(html).toMatch(new RegExp(`aria-describedby="${name}-hint"[^>]*id="${name}"`));
    }
    expect(html).toContain("Create movie</button>");
  });

  it("renders Movie values as inert text", () => {
    const html = renderToStaticMarkup(createElement(MovieForm, {
      initialValues: { ...EMPTY_MOVIE_FORM, title: "<script>alert(1)</script>" },
      onSubmit: async () => null,
      submitLabel: "Save",
      submittingLabel: "Saving…",
    }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("creates announcements as drafts only", () => {
    const html = renderToStaticMarkup(createElement(CreateAnnouncement));
    expect(html).toContain("Save draft</button>");
    expect(html).not.toMatch(/publish<\/button>/i);
    for (const name of ["title", "body", "movieId"]) expect(html).toContain(`<label for="${name}">`);
  });

  it("renders one submit button per announcement action, the first as the default", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementForm, {
      actions: [
        { label: "Save draft", submittingLabel: "Saving…", run: async () => null },
        { label: "Save and publish", submittingLabel: "Publishing…", run: async () => null },
      ],
      initialValues: { title: "T", body: "B", movieId: "" },
    }));
    expect(html.match(/type="submit"/g)).toHaveLength(2);
    expect(html.indexOf("Save draft")).toBeLessThan(html.indexOf("Save and publish"));
    expect(html).toContain('data-action="1"');
  });
});
