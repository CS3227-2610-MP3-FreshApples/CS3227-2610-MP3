import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAnnouncementCreateInput, parseAnnouncementPatchInput } from "../../../src/server/services/announcements";

const REQUIRED = { title: "Title", body: "Body." };
const MOVIE_ID = "0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e";

function fieldsOf(result: ReturnType<typeof parseAnnouncementCreateInput> | ReturnType<typeof parseAnnouncementPatchInput>): string[] {
  if (result.ok) throw new Error("expected a validation failure");
  return Object.keys(result.error);
}

describe("parseAnnouncementCreateInput (D-80, data-model Announcement limits)", () => {
  it("defaults an omitted movieId to null", () => {
    expect(parseAnnouncementCreateInput(REQUIRED)).toEqual({ ok: true, value: { title: "Title", body: "Body.", movieId: null } });
  });

  it("trims text before checking limits and storing it", () => {
    const result = parseAnnouncementCreateInput({ title: ` ${"t".repeat(200)} `, body: `  ${"b".repeat(5_000)}\n` });
    expect(result).toMatchObject({ ok: true, value: { title: "t".repeat(200), body: "b".repeat(5_000) } });
  });

  it("counts code points, not UTF-16 units", () => {
    expect(parseAnnouncementCreateInput({ ...REQUIRED, title: "😀".repeat(200) }).ok).toBe(true);
    expect(fieldsOf(parseAnnouncementCreateInput({ ...REQUIRED, title: "😀".repeat(201) }))).toEqual(["title"]);
  });

  it("lowercases a movieId so no-op comparison matches the stored UUID", () => {
    expect(parseAnnouncementCreateInput({ ...REQUIRED, movieId: MOVIE_ID.toUpperCase() })).toMatchObject({
      ok: true,
      value: { movieId: MOVIE_ID },
    });
  });

  it.each([
    ["title", { body: "B" }],
    ["body", { title: "T" }],
    ["title", { ...REQUIRED, title: "" }],
    ["title", { ...REQUIRED, title: "   " }],
    ["title", { ...REQUIRED, title: "t".repeat(201) }],
    ["title", { ...REQUIRED, title: null }],
    ["body", { ...REQUIRED, body: "\n\t " }],
    ["body", { ...REQUIRED, body: "b".repeat(5_001) }],
    ["body", { ...REQUIRED, body: null }],
    ["movieId", { ...REQUIRED, movieId: "not-a-uuid" }],
    ["movieId", { ...REQUIRED, movieId: 42 }],
  ])("rejects an invalid %s", (field, input) => {
    expect(fieldsOf(parseAnnouncementCreateInput(input))).toEqual([field]);
  });

  it.each(["state", "publishedAt", "authorId", "version", "id", "createdAt", "updatedAt", "unknown"])(
    "rejects the non-writable field %s on creation",
    (field) => {
      expect(fieldsOf(parseAnnouncementCreateInput({ ...REQUIRED, [field]: "x" }))).toEqual([field]);
    },
  );

  it.each([null, [], "text", 7])("rejects a non-object body %j under the key request", (input) => {
    expect(fieldsOf(parseAnnouncementCreateInput(input))).toEqual(["request"]);
  });
});

describe("parseAnnouncementPatchInput (D-80)", () => {
  it("keeps only supplied fields, including a null movieId that clears the reference", () => {
    expect(parseAnnouncementPatchInput({ movieId: null })).toEqual({ ok: true, value: { movieId: null } });
    expect(parseAnnouncementPatchInput({ state: "published", body: " b " })).toEqual({
      ok: true,
      value: { state: "published", body: "b" },
    });
  });

  it("rejects an empty object under the key request", () => {
    expect(fieldsOf(parseAnnouncementPatchInput({}))).toEqual(["request"]);
  });

  it.each([null, [], "text"])("rejects a non-object body %j under the key request", (input) => {
    expect(fieldsOf(parseAnnouncementPatchInput(input))).toEqual(["request"]);
  });

  it.each([
    ["state", { state: "deleted" }],
    ["state", { state: "archived" }],
    ["state", { state: null }],
    ["title", { title: null }],
    ["title", { title: "" }],
    ["body", { body: null }],
    ["body", { body: "b".repeat(5_001) }],
    ["movieId", { movieId: "" }],
  ])("rejects an invalid %s", (field, input) => {
    expect(fieldsOf(parseAnnouncementPatchInput(input))).toEqual([field]);
  });

  it.each(["publishedAt", "authorId", "version", "unknown"])("rejects the non-writable field %s", (field) => {
    expect(fieldsOf(parseAnnouncementPatchInput({ title: "T", [field]: "x" }))).toEqual([field]);
  });
});
