import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { planAnnouncementPatch, type AnnouncementSnapshot } from "../../../src/server/services/announcements";

const MOVIE_ID = "0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e";

function snapshot(state: "draft" | "published"): AnnouncementSnapshot {
  return { title: "Title", body: "Body.", movieId: null, state };
}

describe("planAnnouncementPatch (D-79, D-81)", () => {
  it("treats same values as a no-op audited as announcement.update", () => {
    const plan = planAnnouncementPatch(snapshot("draft"), { title: "Title", movieId: null, state: "draft" });
    expect(plan).toEqual({
      changedFields: [],
      next: snapshot("draft"),
      write: "none",
      action: "announcement.update",
    });
  });

  it("treats state=published on a published Announcement as an update no-op that keeps published_at", () => {
    const plan = planAnnouncementPatch(snapshot("published"), { state: "published" });
    expect(plan.write).toBe("none");
    expect(plan.action).toBe("announcement.update");
  });

  it("publishes a draft, setting a new publication time", () => {
    const plan = planAnnouncementPatch(snapshot("draft"), { state: "published" });
    expect(plan).toMatchObject({ changedFields: ["state"], write: "publish", action: "announcement.publish" });
    expect(plan.next.state).toBe("published");
  });

  it("unpublishes, keeping the previous publication time", () => {
    const plan = planAnnouncementPatch(snapshot("published"), { state: "draft" });
    expect(plan).toMatchObject({ changedFields: ["state"], write: "keep_published_at", action: "announcement.unpublish" });
  });

  it("uses the transition action for a mixed content and state change", () => {
    const plan = planAnnouncementPatch(snapshot("draft"), { body: "New body.", state: "published" });
    expect(plan).toMatchObject({ changedFields: ["body", "state"], write: "publish", action: "announcement.publish" });
    expect(plan.next).toEqual({ title: "Title", body: "New body.", movieId: null, state: "published" });
  });

  it("edits a published Announcement as an update that keeps published_at", () => {
    const plan = planAnnouncementPatch(snapshot("published"), { state: "published", body: "Edited." });
    expect(plan).toMatchObject({ changedFields: ["body"], write: "keep_published_at", action: "announcement.update" });
  });

  it("detects reference changes and keeps omitted fields", () => {
    const set = planAnnouncementPatch(snapshot("draft"), { movieId: MOVIE_ID });
    expect(set).toMatchObject({ changedFields: ["movieId"], write: "keep_published_at" });
    expect(set.next).toEqual({ ...snapshot("draft"), movieId: MOVIE_ID });

    const cleared = planAnnouncementPatch({ ...snapshot("draft"), movieId: MOVIE_ID }, { movieId: null });
    expect(cleared.changedFields).toEqual(["movieId"]);
    expect(cleared.next.movieId).toBeNull();
  });
});
