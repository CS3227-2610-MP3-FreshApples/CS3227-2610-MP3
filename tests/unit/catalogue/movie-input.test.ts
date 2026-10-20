import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseMovieCreateInput, parseMoviePatchInput } from "../../../src/server/services/catalogue";

const REQUIRED = { title: "Title", synopsis: "Synopsis." };

function fieldsOf(result: ReturnType<typeof parseMovieCreateInput> | ReturnType<typeof parseMoviePatchInput>): string[] {
  if (result.ok) throw new Error("expected a validation failure");
  return Object.keys(result.error);
}

describe("parseMovieCreateInput (D-80, data-model Movie limits)", () => {
  it("applies the D-80 defaults to omitted optional fields", () => {
    expect(parseMovieCreateInput(REQUIRED)).toEqual({
      ok: true,
      value: { title: "Title", synopsis: "Synopsis.", releaseDate: null, genres: [], director: "", cast: [], runtimeMinutes: null },
    });
  });

  it("trims text and array elements before checking limits, keeping order and duplicates", () => {
    const result = parseMovieCreateInput({
      title: ` ${"t".repeat(200)} `,
      synopsis: " s ",
      genres: [" b ", "a", "b"],
      cast: ["  Name  "],
      director: "  ",
    });
    expect(result).toMatchObject({ ok: true, value: { title: "t".repeat(200), synopsis: "s", genres: ["b", "a", "b"], cast: ["Name"], director: "" } });
  });

  it("counts code points, not UTF-16 units", () => {
    expect(parseMovieCreateInput({ ...REQUIRED, title: "😀".repeat(200) }).ok).toBe(true);
    expect(fieldsOf(parseMovieCreateInput({ ...REQUIRED, title: "😀".repeat(201) }))).toEqual(["title"]);
  });

  it.each([
    ["title", { synopsis: "S" }],
    ["title", { ...REQUIRED, title: "" }],
    ["title", { ...REQUIRED, title: null }],
    ["synopsis", { ...REQUIRED, synopsis: "x".repeat(5001) }],
    ["director", { ...REQUIRED, director: "x".repeat(201) }],
    ["director", { ...REQUIRED, director: null }],
    ["genres", { ...REQUIRED, genres: Array.from({ length: 11 }, () => "g") }],
    ["genres", { ...REQUIRED, genres: ["x".repeat(41)] }],
    ["genres", { ...REQUIRED, genres: [" "] }],
    ["genres", { ...REQUIRED, genres: "Drama" }],
    ["cast", { ...REQUIRED, cast: Array.from({ length: 31 }, () => "c") }],
    ["cast", { ...REQUIRED, cast: ["x".repeat(101)] }],
    ["cast", { ...REQUIRED, cast: [1] }],
    ["runtimeMinutes", { ...REQUIRED, runtimeMinutes: 0 }],
    ["runtimeMinutes", { ...REQUIRED, runtimeMinutes: 1001 }],
    ["runtimeMinutes", { ...REQUIRED, runtimeMinutes: "90" }],
    ["releaseDate", { ...REQUIRED, releaseDate: "2023-02-29" }],
    ["releaseDate", { ...REQUIRED, releaseDate: "1900-02-29" }],
    ["releaseDate", { ...REQUIRED, releaseDate: "2023-13-01" }],
    ["releaseDate", { ...REQUIRED, releaseDate: "0000-01-01" }],
    ["releaseDate", { ...REQUIRED, releaseDate: "10000-01-01" }],
    ["releaseDate", { ...REQUIRED, releaseDate: "2023-1-1" }],
    ["releaseDate", { ...REQUIRED, releaseDate: "2023-01-01T00:00:00Z" }],
    ["poster", { ...REQUIRED, poster: "x" }],
    ["version", { ...REQUIRED, version: 1 }],
    ["archivedAt", { ...REQUIRED, archivedAt: null }],
  ])("reports %s for %j", (field, input) => {
    expect(fieldsOf(parseMovieCreateInput(input))).toContain(field);
  });

  it("accepts boundary values", () => {
    const result = parseMovieCreateInput({
      ...REQUIRED,
      releaseDate: "2000-02-29",
      runtimeMinutes: 1,
      genres: Array.from({ length: 10 }, () => "x".repeat(40)),
      cast: Array.from({ length: 30 }, () => "x".repeat(100)),
      director: "x".repeat(200),
    });
    expect(result.ok).toBe(true);
    expect(parseMovieCreateInput({ ...REQUIRED, releaseDate: "0001-01-01", runtimeMinutes: 1000 }).ok).toBe(true);
    expect(parseMovieCreateInput({ ...REQUIRED, releaseDate: "9999-12-31" }).ok).toBe(true);
    expect(parseMovieCreateInput({ ...REQUIRED, releaseDate: null, runtimeMinutes: null }).ok).toBe(true);
  });

  it.each([null, [], "text", 3])("rejects a non-object body %j", (input) => {
    expect(parseMovieCreateInput(input).ok).toBe(false);
  });
});

describe("parseMoviePatchInput (D-80)", () => {
  it("keeps only supplied fields, so omitted fields stay unchanged", () => {
    expect(parseMoviePatchInput({ synopsis: " New " })).toEqual({ ok: true, value: { synopsis: "New" } });
  });

  it("accepts the D-80 clearing values", () => {
    expect(parseMoviePatchInput({ releaseDate: null, runtimeMinutes: null, genres: [], cast: [], director: " " })).toEqual({
      ok: true,
      value: { releaseDate: null, runtimeMinutes: null, genres: [], cast: [], director: "" },
    });
  });

  it("rejects an empty object", () => {
    expect(parseMoviePatchInput({}).ok).toBe(false);
  });

  it.each([
    ["title", { title: null }],
    ["synopsis", { synopsis: "  " }],
    ["director", { director: null }],
    ["genres", { genres: null }],
    ["cast", { cast: null }],
    ["reviewsRevision", { title: "T", reviewsRevision: 2 }],
  ])("reports %s for %j", (field, input) => {
    expect(fieldsOf(parseMoviePatchInput(input))).toContain(field);
  });
});
